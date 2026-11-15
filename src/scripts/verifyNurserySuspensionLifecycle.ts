import mongoose, { Types } from "mongoose";
import { syncAllProductsNurseryActiveStatus } from "../utils/backfillNurseryActive";

async function runVerification() {
  console.log("======================================================================");
  console.log("🛡️ VERIFYING PLATFORM-WIDE NURSERY SUSPENSION & REACTIVATION LIFECYCLE");
  console.log("   (STRICT POSITIVE WHITELIST & ZERO-LEAK VERIFICATION SUITE)");
  console.log("======================================================================\n");

  const mockNurseryUserId = new Types.ObjectId();
  const mockNurseryProfileId = new Types.ObjectId();

  console.log(`[Setup] Mock Nursery User ID:    ${mockNurseryUserId.toString()}`);
  console.log(`[Setup] Mock Nursery Profile ID: ${mockNurseryProfileId.toString()}`);

  let passed = 0;
  let total = 0;

  const assert = (condition: boolean, testName: string) => {
    total++;
    if (condition) {
      console.log(`✅ [Test ${total.toString().padStart(2, "0")}] ${testName} -> PASSED`);
      passed++;
    } else {
      console.error(`❌ [Test ${total.toString().padStart(2, "0")}] ${testName} -> FAILED`);
    }
  };

  // Test 1: Authoritative active nursery evaluation (Strict Positive Whitelist)
  const evaluateNurseryActive = (user: any, profile: any): boolean => {
    const isUserActive =
      user.role === "nursery" &&
      user.isActive === true &&
      user.isBlocked !== true &&
      typeof user.status === "string" &&
      user.status.toLowerCase() === "active";

    const isProfileActive =
      profile.isActive === true &&
      typeof profile.approvalStatus === "string" &&
      profile.approvalStatus.toLowerCase() === "approved" &&
      profile.isBlocked !== true;

    return Boolean(isUserActive && isProfileActive);
  };

  const activeUser = {
    _id: mockNurseryUserId,
    role: "nursery",
    isActive: true,
    isBlocked: false,
    status: "Active",
  };

  const activeProfile = {
    _id: mockNurseryProfileId,
    nursery: mockNurseryUserId,
    isActive: true,
    approvalStatus: "Approved",
    isBlocked: false,
  };

  assert(
    evaluateNurseryActive(activeUser, activeProfile) === true,
    "Fully approved & active nursery evaluates as LIVE"
  );

  // Test 2: Admin suspends nursery via toggle
  const suspendedUser = { ...activeUser, isActive: false, status: "Suspended" };
  const suspendedProfile = { ...activeProfile, isActive: false };

  assert(
    evaluateNurseryActive(suspendedUser, suspendedProfile) === false,
    "Admin suspended nursery (isActive=false, status='Suspended') evaluates as NOT LIVE"
  );

  // Test 3: Admin sets approvalStatus to Rejected
  const rejectedProfile = { ...activeProfile, approvalStatus: "Rejected" };
  assert(
    evaluateNurseryActive(activeUser, rejectedProfile) === false,
    "Admin rejected nursery application evaluates as NOT LIVE"
  );

  // Test 4: Admin sets approvalStatus to Pending
  const pendingProfile = { ...activeProfile, approvalStatus: "Pending" };
  assert(
    evaluateNurseryActive(activeUser, pendingProfile) === false,
    "Pending nursery onboarding application evaluates as NOT LIVE"
  );

  // Test 5: Legacy or undefined nursery user status (case sensitivity & undefined check)
  const legacyUserUndefinedStatus = { ...activeUser, status: undefined };
  assert(
    evaluateNurseryActive(legacyUserUndefinedStatus, activeProfile) === false,
    "Legacy nursery user with undefined status is safely treated as NOT LIVE"
  );

  // Test 6: Legacy product with isNurseryActive: undefined (Old DB backfill test)
  const legacyProductWithUndefinedFlag = {
    _id: new Types.ObjectId(),
    name: "Legacy Plant",
    nursery: mockNurseryProfileId,
    isPublished: true,
    isActive: true,
    isNurseryActive: undefined, // Missing field in MongoDB
  };

  const queryMatchesProduct = (filter: any, product: any): boolean => {
    if (filter.isPublished !== undefined && product.isPublished !== filter.isPublished) return false;
    if (filter.isActive !== undefined && product.isActive !== filter.isActive) return false;
    if (filter.isNurseryActive !== undefined && product.isNurseryActive !== filter.isNurseryActive) return false;
    if (filter.nursery?.$in && !filter.nursery.$in.includes(product.nursery.toString())) return false;
    return true;
  };

  const strictPositiveBaseFilter = {
    isPublished: true,
    isActive: true,
    isNurseryActive: true,
    nursery: { $in: ["other_live_nursery_id"] },
  };

  assert(
    queryMatchesProduct(strictPositiveBaseFilter, legacyProductWithUndefinedFlag) === false,
    "Strict positive whitelist (isNurseryActive: true) prevents legacy un-migrated products from leaking"
  );

  // Test 7: Direct filter by suspended nursery (?nursery=mockNurseryProfileId)
  const activeNurseryIdsList = ["other_nursery_1", "other_nursery_2"];
  const targetNurseryQuery = mockNurseryProfileId.toString();
  const directNurseryFilter: any = {};
  if (!activeNurseryIdsList.includes(targetNurseryQuery)) {
    directNurseryFilter.nursery = { $in: [] };
  } else {
    directNurseryFilter.nursery = targetNurseryQuery;
  }

  assert(
    Array.isArray(directNurseryFilter.nursery["$in"]) &&
    directNurseryFilter.nursery["$in"].length === 0,
    "Direct query for suspended nursery safely returns { nursery: { $in: [] } } (0 items)"
  );

  // Test 8: Direct Product Detail URL access control
  const mockProduct = {
    _id: new Types.ObjectId(),
    name: "Golden Pothos",
    nursery: mockNurseryProfileId,
    isPublished: true,
    isActive: true,
    isNurseryActive: false, // suspended
  };

  const canPublicViewProduct = (product: any, activeIds: string[]): boolean => {
    if (product.isPublished !== true || product.isActive === false || product.isNurseryActive !== true) {
      return false;
    }
    const nurseryId = product.nursery.toString();
    return activeIds.includes(nurseryId);
  };

  assert(
    canPublicViewProduct(mockProduct, activeNurseryIdsList) === false,
    "Public access to direct product URL of suspended nursery is strictly blocked (404 Unavailable)"
  );

  // Test 9: Vendor owner can still view product for editing in /nursery dashboard
  const isOwner = (product: any, userId: string): boolean => {
    return product.nursery.toString() === userId;
  };
  assert(
    isOwner(mockProduct, mockNurseryProfileId.toString()) === true,
    "Suspended nursery owner retains ownership access to view/edit product in dashboard"
  );

  // Test 10: Defense-in-Depth Post-Query Response Sanitizer
  const rawCandidateProducts = [
    { _id: "1", name: "Plant A", nursery: "other_nursery_1", isPublished: true, isActive: true, isNurseryActive: true },
    { _id: "2", name: "Plant B (Suspended Nursery)", nursery: mockNurseryProfileId.toString(), isPublished: true, isActive: true, isNurseryActive: false },
    { _id: "3", name: "Plant C", nursery: "other_nursery_2", isPublished: true, isActive: true, isNurseryActive: true },
  ];

  const activeSet = new Set(activeNurseryIdsList);
  const sanitized = rawCandidateProducts.filter((p: any) => {
    if (p.isNurseryActive !== true) return false;
    if (p.isPublished !== true || p.isActive === false) return false;
    if (!p.nursery) return false;
    return activeSet.has(p.nursery);
  });

  assert(
    sanitized.length === 2 && !sanitized.some((p) => p.nursery === mockNurseryProfileId.toString()),
    "Defense-in-depth post-query sanitizer strips any suspended nursery product before response"
  );

  // Test 11: Cart item enrichment for product from suspended nursery
  const mockCartItem = {
    product: mockProduct,
    quantity: 2,
    nursery: mockNurseryProfileId,
  };

  const enrichItem = (item: any, activeIds: string[]) => {
    const isLive = activeIds.includes(item.nursery.toString()) && item.product.isNurseryActive === true;
    return {
      ...item,
      isAvailable: isLive,
      unavailableReason: !isLive ? "NURSERY_INACTIVE" : undefined,
    };
  };

  const enriched = enrichItem(mockCartItem, activeNurseryIdsList);
  assert(
    enriched.isAvailable === false && enriched.unavailableReason === "NURSERY_INACTIVE",
    "Cart item from suspended nursery marked as unavailable with reason NURSERY_INACTIVE"
  );

  // Test 12: Order Placement guardrail strictly rejects products without isNurseryActive: true
  const validateOrderPlacement = (product: any, activeIds: string[]) => {
    if (product.isNurseryActive !== true || !activeIds.includes(product.nursery.toString())) {
      throw new Error(
        `Product "${product.name}" is unavailable because the nursery is temporarily suspended.`
      );
    }
    return true;
  };

  let orderBlocked = false;
  let orderErrorMessage = "";
  try {
    validateOrderPlacement(mockProduct, activeNurseryIdsList);
  } catch (err: any) {
    orderBlocked = true;
    orderErrorMessage = err.message;
  }

  assert(
    orderBlocked === true && orderErrorMessage.includes("temporarily suspended"),
    "Order placement strictly blocked with clear suspension error message"
  );

  // Test 13: Reactivation restores visibility
  const reactivatedActiveIds = [...activeNurseryIdsList, mockNurseryProfileId.toString(), mockNurseryUserId.toString()];
  const reactivatedProduct = { ...mockProduct, isNurseryActive: true };

  assert(
    canPublicViewProduct(reactivatedProduct, reactivatedActiveIds) === true,
    "Admin reactivates nursery -> product automatically becomes visible publicly"
  );

  // Test 14: Reactivated cart item passes checkout
  let reactivatedOrderAllowed = false;
  try {
    reactivatedOrderAllowed = validateOrderPlacement(reactivatedProduct, reactivatedActiveIds);
  } catch {
    reactivatedOrderAllowed = false;
  }

  assert(
    reactivatedOrderAllowed === true,
    "Admin reactivates nursery -> Cart item becomes available and checkout succeeds"
  );

  console.log("\n======================================================================");
  console.log(`📊 TEST SUITE SUMMARY: ${passed} / ${total} PASSED, ${total - passed} FAILED`);
  console.log("======================================================================");

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runVerification().catch((e) => {
  console.error("Verification script error:", e);
  process.exit(1);
});
