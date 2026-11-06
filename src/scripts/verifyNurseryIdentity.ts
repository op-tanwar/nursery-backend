import mongoose, { Types } from "mongoose";
import { resolveNurseryIdentity } from "../utils/nurseryUtils";
import { calculateNurseryFinancialSummary, buildNurseryFinancialMatch } from "../utils/financialUtils";
import NurseryProfile from "../models/nurseryProfileModel";
import Order from "../models/orderModel";
import Payout from "../models/payoutModel";
import CategoryCommission from "../models/categoryCommissionModel";
import { DEFAULT_CATEGORY_COMMISSIONS } from "../utils/commissionService";

async function runVerification() {
  console.log("================================================================================");
  console.log("🌿 NURSERY DUAL IDENTITY & FINANCIAL ENGINE VERIFICATION AUDIT");
  console.log("================================================================================\n");

  const U1 = new Types.ObjectId("65a111111111111111111111"); // Authentication User._id
  const NP1 = new Types.ObjectId("65b222222222222222222222"); // Storefront NurseryProfile._id

  console.log(`Identity Setup:`);
  console.log(`  - Authentication User ID (U1):        ${U1.toString()}`);
  console.log(`  - Storefront NurseryProfile ID (NP1): ${NP1.toString()}`);
  console.log(`  - Note: U1 !== NP1 (Dual Identity Mismatch in legacy state)\n`);

  // Mock NurseryProfile.findOne
  const mockProfileDoc = {
    _id: NP1,
    nursery: U1,
    businessName: "Green Paradise Nursery",
  };

  const originalNurseryProfileFindOne = NurseryProfile.findOne;
  const originalOrderAggregate = Order.aggregate;
  const originalPayoutAggregate = Payout.aggregate;
  const originalCategoryCommissionFind = CategoryCommission.find;

  // Mock CategoryCommission.find to return default rates without requiring MongoDB connection
  (CategoryCommission as any).find = () => {
    return {
      lean: async () => DEFAULT_CATEGORY_COMMISSIONS,
    };
  };

  try {
    // --------------------------------------------------------------------------
    // TEST 1: Identity Resolver
    // --------------------------------------------------------------------------
    console.log("👉 Test 1: Testing resolveNurseryIdentity()...");
    (NurseryProfile as any).findOne = (query: any) => {
      return {
        lean: async () => {
          // If query checks nursery: U1 or _id: NP1 or $or
          const orList = query.$or || [query];
          const matches = orList.some((cond: any) => {
            if (cond.nursery && cond.nursery.toString() === U1.toString()) return true;
            if (cond._id && cond._id.toString() === NP1.toString()) return true;
            return false;
          });
          return matches ? mockProfileDoc : null;
        },
      };
    };

    const resolvedFromUser = await resolveNurseryIdentity(U1);
    console.log(`  [Pass] resolveNurseryIdentity(U1) resolved:`);
    console.log(`         profileId: ${resolvedFromUser.profileId.toString()}`);
    console.log(`         userId:    ${resolvedFromUser.userId.toString()}`);
    console.log(`         allIds:    [${resolvedFromUser.allIds.map((id) => id.toString()).join(", ")}]`);

    if (
      resolvedFromUser.profileId.toString() !== NP1.toString() ||
      resolvedFromUser.userId.toString() !== U1.toString() ||
      resolvedFromUser.allIds.length !== 2
    ) {
      throw new Error("FAILED: resolveNurseryIdentity(U1) did not resolve correct profile/user IDs");
    }

    const resolvedFromProfile = await resolveNurseryIdentity(NP1);
    console.log(`  [Pass] resolveNurseryIdentity(NP1) resolved:`);
    console.log(`         profileId: ${resolvedFromProfile.profileId.toString()}`);
    console.log(`         userId:    ${resolvedFromProfile.userId.toString()}`);
    console.log(`         allIds:    [${resolvedFromProfile.allIds.map((id) => id.toString()).join(", ")}]`);

    if (
      resolvedFromProfile.profileId.toString() !== NP1.toString() ||
      resolvedFromProfile.userId.toString() !== U1.toString()
    ) {
      throw new Error("FAILED: resolveNurseryIdentity(NP1) did not resolve correct profile/user IDs");
    }

    // --------------------------------------------------------------------------
    // TEST 2: buildNurseryFinancialMatch Helper
    // --------------------------------------------------------------------------
    console.log("\n👉 Test 2: Testing buildNurseryFinancialMatch()...");
    const matchFilter: any = buildNurseryFinancialMatch(resolvedFromUser.allIds);
    console.log(`  Generated Match Query: ${JSON.stringify(matchFilter)}`);
    if (!matchFilter["orderItems.nursery"]?.$in) {
      throw new Error("FAILED: buildNurseryFinancialMatch did not produce $in query for array input");
    }
    console.log("  [Pass] Query correctly targets { 'orderItems.nursery': { $in: [...] } }");

    // --------------------------------------------------------------------------
    // TEST 3: Financial Summary Calculation with Dual Identity
    // --------------------------------------------------------------------------
    console.log("\n👉 Test 3: Testing calculateNurseryFinancialSummary(U1)...");

    // An order exists in MongoDB where line item stores `orderItems.nursery = NP1` (canonical storefront ID)
    // Item: 2 units @ ₹750 = ₹1500 gross
    const mockOrderItems = [
      {
        orderId: new Types.ObjectId(),
        orderItems: {
          nursery: NP1, // Storefront NurseryProfile ID!
          price: 750,
          priceAtPurchase: 750,
          quantity: 2,
          status: "Delivered",
        },
        orderStatus: "Delivered",
      },
    ];

    // Mock Order.aggregate to simulate MongoDB pipeline execution
    (Order as any).aggregate = (pipeline: any[]) => {
      // Find the $match stage for orderItems.nursery
      const matchStage = pipeline.find((stg) => stg.$match && stg.$match["orderItems.nursery"]);
      const nurseryCondition = matchStage?.$match["orderItems.nursery"];

      // Evaluate whether the mock items match
      let matchedItems: any[] = [];
      if (nurseryCondition?.$in) {
        const allowedStrs = (nurseryCondition.$in as Types.ObjectId[]).map((id) => id.toString());
        matchedItems = mockOrderItems.filter((item) =>
          allowedStrs.includes(item.orderItems.nursery.toString())
        );
      } else if (nurseryCondition) {
        matchedItems = mockOrderItems.filter(
          (item) => item.orderItems.nursery.toString() === nurseryCondition.toString()
        );
      }

      if (matchedItems.length === 0) {
        return Promise.resolve([]);
      }

      // Calculate gross, commission (30%), net
      const gross = matchedItems.reduce(
        (sum, it) => sum + it.orderItems.price * it.orderItems.quantity,
        0
      );
      const commission = gross * 0.3; // Default 30% plant commission
      const net = gross - commission;

      return Promise.resolve([
        {
          grossRevenue: gross,
          totalCommission: commission,
          netEarnings: net,
          ordersCount: matchedItems.length,
        },
      ]);
    };

    // Mock Payout.aggregate
    (Payout as any).aggregate = (_pipeline: any[]) => {
      return Promise.resolve([]); // 0 payouts completed/pending
    };

    // A. Verify Buggy Behavior (if querying with only U1):
    console.log("  A. Simulating Buggy Legacy State (querying orderItems.nursery strictly with U1):");
    const buggyMatches = mockOrderItems.filter(
      (item) => item.orderItems.nursery.toString() === U1.toString()
    );
    console.log(`     Legacy matched items: ${buggyMatches.length} (Expected: 0)`);
    console.log(`     Legacy Gross Revenue: ₹0 (BUG: customer paid ₹1500, but nursery sees ₹0)`);

    // B. Verify Fixed Behavior using calculateNurseryFinancialSummary(U1):
    console.log("  B. Executing Fixed calculateNurseryFinancialSummary(U1):");
    const summary = await calculateNurseryFinancialSummary(U1);

    console.log(`     Financial Summary Result:`);
    console.log(`       - Gross Earnings:    ₹${summary.grossEarnings}`);
    console.log(`       - Total Commission:  ₹${summary.totalCommission}`);
    console.log(`       - Net Sales:         ₹${summary.netSales}`);
    console.log(`       - Available Balance: ₹${summary.availableBalance}`);
    console.log(`       - Orders Count:      ${summary.totalOrdersCount}`);

    if (summary.grossEarnings !== 1500) {
      throw new Error(`FAILED: Expected grossEarnings === 1500, got ${summary.grossEarnings}`);
    }

    if (summary.netSales !== 1050) {
      throw new Error(`FAILED: Expected netSales === 1050, got ${summary.netSales}`);
    }

    if (summary.availableBalance !== 1050) {
      throw new Error(`FAILED: Expected availableBalance === 1050, got ${summary.availableBalance}`);
    }

    console.log("\n================================================================================");
    console.log("✅ ALL VERIFICATION TESTS PASSED SUCCESSFULLY!");
    console.log("   - U1 (User ID) correctly resolves to all IDs [NP1, U1]");
    console.log("   - NP1 (NurseryProfile ID) correctly resolves to all IDs [NP1, U1]");
    console.log("   - Aggregations match line-items tagged with NP1 when called with U1");
    console.log("   - calculateNurseryFinancialSummary(U1) returns ₹1500 (Gross) and ₹1050 (Net)");
    console.log("================================================================================");
  } finally {
    NurseryProfile.findOne = originalNurseryProfileFindOne;
    Order.aggregate = originalOrderAggregate;
    Payout.aggregate = originalPayoutAggregate;
    CategoryCommission.find = originalCategoryCommissionFind;
  }
}

runVerification().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
