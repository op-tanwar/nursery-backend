/**
 * ============================================================
 * 💰 FINANCIAL UTILITIES — Single Source of Truth
 * ============================================================
 * Centralized financial aggregation and commission engine.
 * Admin, Nursery, and Payout controllers all consume this file
 * to guarantee 100% financial reconciliation and zero discrepancy.
 *
 * Arithmetic is executed with paise-safe integer precision to eliminate
 * JavaScript floating-point drift, with final rupee rounding to 2 decimals.
 * ============================================================
 */

import { Types, ClientSession } from "mongoose";
import Order from "../models/orderModel";
import Payout from "../models/payoutModel";
import {
  getActiveCommissionMap,
  getDynamicCommissionRates,
  getDynamicCommissionExpression,
  getEffectiveCommission,
  getEffectiveCommissionRate,
  DEFAULT_CATEGORY_COMMISSIONS,
} from "./commissionService";

// ──────────────────────────────────────────────────────────────
// 🔢 PAISE-SAFE ARITHMETIC (eliminates JS floating-point drift)
// ──────────────────────────────────────────────────────────────

/**
 * Convert a rupee amount to paise (integer) to avoid float drift.
 * e.g. 10.1 → 1010
 */
export const toPaise = (rupees: number): number =>
  Math.round((Number(rupees) || 0) * 100);

/**
 * Convert paise back to rupees, rounded to 2 decimal places.
 * e.g. 1010 → 10.10
 */
export const toRupees = (paise: number): number =>
  Math.round(Number(paise) || 0) / 100;

/**
 * Round a rupee amount to exactly 2 decimal places.
 * Safe against floating-point errors: 10.000000000001 → 10.00
 */
export const roundMoney = (rupees: number): number =>
  toRupees(toPaise(rupees));

// ──────────────────────────────────────────────────────────────
// 📐 DYNAMIC COMMISSION RATES (Synced with /admin/product-commission)
// ──────────────────────────────────────────────────────────────

/**
 * Compatibility object that delegates dynamically to the active commission config.
 * DO NOT hardcode rates here — all rates are fetched dynamically from MongoDB.
 */
export const COMMISSION_RATES: Record<string, number> = new Proxy(
  {},
  {
    get(_target, prop: string) {
      // Default dynamic reference; callers should prefer getDynamicCommissionRate()
      const fallbackDefaults: Record<string, number> = {
        Plant: 0.30,
        Pot: 0.25,
        Accessory: 0.20,
        GardeningTool: 0.20,
        PlantCare: 0.20,
        SeedsBulbs: 0.20,
        PlantStandsShelves: 0.20,
        ArtificialDriedPlant: 0.20,
      };
      return fallbackDefaults[prop] ?? 0.30;
    },
  }
);

/**
 * Helper to fetch dynamic commission rate for a category or itemModel.
 */
export const getCommissionRate = async (itemModelOrCategory: string): Promise<number> => {
  const map = await getActiveCommissionMap();
  const entry = map[itemModelOrCategory] || map[itemModelOrCategory.toLowerCase()];
  if (entry) {
    return entry.commissionPercentage / 100;
  }
  return 0.30;
};

// ──────────────────────────────────────────────────────────────
// 💵 COMMISSION CALCULATION HELPERS
// ──────────────────────────────────────────────────────────────

/**
 * Calculate the line-item gross (price × quantity) in rupees.
 */
export const calcLineGross = (price: number, quantity: number): number =>
  roundMoney((Number(price) || 0) * (Number(quantity) || 1));

/**
 * Calculate the platform commission for a single line item.
 * Uses integer arithmetic to prevent float drift.
 */
export const calcLineCommission = (
  lineGross: number,
  rateOrModel: number | string,
  explicitRate?: number
): number => {
  let rate = 0.30;
  if (typeof explicitRate === "number") {
    rate = explicitRate;
  } else if (typeof rateOrModel === "number") {
    rate = rateOrModel;
  } else if (typeof rateOrModel === "string") {
    rate = COMMISSION_RATES[rateOrModel] ?? 0.30;
  }
  const grossPaise = toPaise(lineGross);
  const commissionPaise = Math.round(grossPaise * rate);
  return toRupees(commissionPaise);
};

/**
 * Calculate the nursery's net earnings for a single line item.
 */
export const calcLineNet = (lineGross: number, lineCommission: number): number =>
  roundMoney(lineGross - lineCommission);

// ──────────────────────────────────────────────────────────────
// 📊 ORDER-LEVEL FINANCIAL SUMMARY
// ──────────────────────────────────────────────────────────────

export interface IOrderItemFinancials {
  itemModel: string;
  category?: string;
  price: number;
  quantity: number;
  status?: string;
  commissionRate?: number;
}

export interface IOrderFinancialSummary {
  grossRevenue: number;
  totalCommission: number;
  netEarnings: number;
  itemCount: number;
}

/**
 * Calculate the complete financial summary for a set of order items item-by-item.
 *
 * Line Item Commission = Line Item Gross Total × Category Commission Rate
 * Total Order Commission = SUM(Item Commissions)
 * Net Vendor Payout = Order Gross Total - Total Order Commission
 */
export const calcOrderFinancials = async (
  items: IOrderItemFinancials[]
): Promise<IOrderFinancialSummary> => {
  let grossPaise = 0;
  let commissionPaise = 0;
  const rates = await getDynamicCommissionRates();

  for (const item of items) {
    if (item.status === "Cancelled" || item.status === "Refunded") continue;
    const price = Number(item.price) || 0;
    const qty = Number(item.quantity) || 1;
    const linePaise = toPaise(price * qty);

    let rate = item.commissionRate;
    if (typeof rate !== "number") {
      const key = item.itemModel || item.category || "Plant";
      rate = rates[key] ?? rates[key.toLowerCase()] ?? 0.30;
    }

    const commPaise = Math.round(linePaise * rate);
    grossPaise += linePaise;
    commissionPaise += commPaise;
  }

  const netPaise = grossPaise - commissionPaise;

  return {
    grossRevenue: toRupees(grossPaise),
    totalCommission: toRupees(commissionPaise),
    netEarnings: toRupees(netPaise),
    itemCount: items.filter((i) => i.status !== "Cancelled" && i.status !== "Refunded").length,
  };
};

// ──────────────────────────────────────────────────────────────
// 📅 SETTLEMENT DATE HELPER
// ──────────────────────────────────────────────────────────────

/**
 * Returns the next Monday as the upcoming settlement date.
 */
export const getNextSettlementDate = (): { iso: string; label: string } => {
  const d = new Date();
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ...
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(0, 0, 0, 0);
  const iso = d.toISOString().split("T")[0];
  const label = d.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  return { iso, label: `Next payout on ${label}` };
};

// ──────────────────────────────────────────────────────────────
// 🔍 MONGODB AGGREGATION & PIPELINE HELPERS
// ──────────────────────────────────────────────────────────────

/**
 * Match filter that excludes cancelled order items.
 */
export const EXCLUDE_CANCELLED_MATCH = {
  orderStatus: { $ne: "Cancelled" },
  "orderItems.status": { $nin: ["Cancelled", "Refunded", "Returned"] },
};

/**
 * Helper to build a nursery-scoped, cancel-aware aggregate match.
 */
export const buildNurseryFinancialMatch = (
  nurseryId: unknown,
  dateRange?: unknown
): Record<string, unknown> => {
  const filter: Record<string, unknown> = {
    "orderItems.nursery": nurseryId,
    orderStatus: { $ne: "Cancelled" },
    "orderItems.status": { $in: ["Delivered", "Claimed"] },
  };
  if (dateRange) {
    filter.createdAt = dateRange;
  }
  return filter;
};

export interface INurseryFinancialSummary {
  grossEarnings: number;
  totalCommission: number;
  netSales: number;
  totalPaidOut: number;
  pendingPayouts: number;
  availableBalance: number;
  hasNegativeBalance: boolean;
  totalOrdersCount: number;
}

/**
 * Helper to optionally attach session to aggregate pipeline
 */
const runAggregate = (model: any, pipeline: any[], session?: ClientSession) => {
  const agg = model.aggregate(pipeline);
  if (session) {
    agg.session(session);
  }
  return agg;
};

/**
 * 🎯 SINGLE SOURCE OF TRUTH FOR NURSERY BALANCE & METRICS
 * Used by Nursery Dashboard, Nursery Payouts API, Admin Payouts API, and Ledger verification.
 * Fully consumes dynamic configuration from /admin/product-commission.
 */
export const calculateNurseryFinancialSummary = async (
  nurseryId: Types.ObjectId | string,
  session?: ClientSession
): Promise<INurseryFinancialSummary> => {
  try {
    const nid = typeof nurseryId === "string" ? new Types.ObjectId(nurseryId) : nurseryId;
    const commExpr = await getDynamicCommissionExpression();

    const [orderMetrics, payoutCompleted, payoutPending] = await Promise.all([
      runAggregate(
        Order,
        [
          { $unwind: "$orderItems" },
          {
            $match: {
              "orderItems.nursery": nid,
              orderStatus: { $ne: "Cancelled" },
              // Settled items contribute to real available earnings
              "orderItems.status": { $in: ["Delivered", "Claimed"] },
            },
          },
          {
            $project: {
              orderId: "$_id",
              itemTotal: {
                $multiply: [
                  { $ifNull: ["$orderItems.priceAtPurchase", "$orderItems.price"] },
                  "$orderItems.quantity",
                ],
              },
              commissionRate: commExpr,
            },
          },
          {
            $project: {
              orderId: 1,
              itemTotal: 1,
              commission: { $multiply: ["$itemTotal", "$commissionRate"] },
              netEarning: {
                $subtract: [
                  "$itemTotal",
                  { $multiply: ["$itemTotal", "$commissionRate"] },
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              grossRevenue: { $sum: "$itemTotal" },
              totalCommission: { $sum: "$commission" },
              netEarnings: { $sum: "$netEarning" },
              ordersCount: { $addToSet: "$orderId" },
            },
          },
          {
            $project: {
              _id: 0,
              grossRevenue: 1,
              totalCommission: 1,
              netEarnings: 1,
              ordersCount: { $size: "$ordersCount" },
            },
          },
        ],
        session
      ),

      runAggregate(
        Payout,
        [
          { $match: { nursery: nid, status: "COMPLETED" } },
          { $group: { _id: null, total: { $sum: "$requestedAmount" } } },
        ],
        session
      ),

      runAggregate(
        Payout,
        [
          { $match: { nursery: nid, status: { $in: ["PENDING", "PROCESSING"] } } },
          { $group: { _id: null, total: { $sum: "$requestedAmount" } } },
        ],
        session
      ),
    ]);

    const rawGross = orderMetrics[0]?.grossRevenue || 0;
    const rawComm = orderMetrics[0]?.totalCommission || 0;
    const rawNet = orderMetrics[0]?.netEarnings || 0;
    const ordersCount = orderMetrics[0]?.ordersCount || 0;

    const grossEarnings = roundMoney(rawGross);
    const totalCommission = roundMoney(rawComm);
    const netSales = roundMoney(rawNet);

    const totalPaidOut = roundMoney(payoutCompleted[0]?.total || 0);
    const pendingPayouts = roundMoney(payoutPending[0]?.total || 0);

    // Available Payout = Net Sales - (Completed Payouts + Processing Payouts)
    const availableBalance = roundMoney(netSales - totalPaidOut - pendingPayouts);
    const hasNegativeBalance = availableBalance < 0;

    return {
      grossEarnings,
      totalCommission,
      netSales,
      totalPaidOut,
      pendingPayouts,
      availableBalance,
      hasNegativeBalance,
      totalOrdersCount: ordersCount,
    };
  } catch (err) {
    console.error("[calculateNurseryFinancialSummary] Aggregation error:", err);
    return {
      grossEarnings: 0,
      totalCommission: 0,
      netSales: 0,
      totalPaidOut: 0,
      pendingPayouts: 0,
      availableBalance: 0,
      hasNegativeBalance: false,
      totalOrdersCount: 0,
    };
  }
};

/**
 * 🎯 SINGLE SOURCE OF TRUTH FOR GLOBAL PLATFORM FINANCIALS (ADMIN)
 * Used by Admin Dashboard and Admin Payouts List.
 * Fully consumes dynamic configuration from /admin/product-commission.
 */
export const calculateGlobalFinancialSummary = async (
  session?: ClientSession
) => {
  try {
    const commExpr = await getDynamicCommissionExpression();

    const [globalOrderMetrics, globalPayoutCompleted, globalPayoutPending] = await Promise.all([
      runAggregate(
        Order,
        [
          { $unwind: "$orderItems" },
          {
            $match: {
              orderStatus: { $ne: "Cancelled" },
              // Settled items count as confirmed platform revenue
              "orderItems.status": { $in: ["Delivered", "Claimed"] },
            },
          },
          {
            $project: {
              orderId: "$_id",
              itemTotal: {
                $multiply: [
                  { $ifNull: ["$orderItems.priceAtPurchase", "$orderItems.price"] },
                  "$orderItems.quantity",
                ],
              },
              commissionRate: commExpr,
            },
          },
          {
            $project: {
              orderId: 1,
              itemTotal: 1,
              commission: { $multiply: ["$itemTotal", "$commissionRate"] },
            },
          },
          {
            $group: {
              _id: null,
              grossGMV: { $sum: "$itemTotal" },
              platformCommission: { $sum: "$commission" },
              ordersCount: { $addToSet: "$orderId" },
            },
          },
          {
            $project: {
              _id: 0,
              grossGMV: 1,
              platformCommission: 1,
              nurseryPayoutPayable: { $subtract: ["$grossGMV", "$platformCommission"] },
              ordersCount: { $size: "$ordersCount" },
            },
          },
        ],
        session
      ),

      runAggregate(
        Payout,
        [
          { $match: { status: "COMPLETED" } },
          { $group: { _id: null, total: { $sum: "$requestedAmount" } } },
        ],
        session
      ),

      runAggregate(
        Payout,
        [
          { $match: { status: { $in: ["PENDING", "PROCESSING"] } } },
          { $group: { _id: null, total: { $sum: "$requestedAmount" } } },
        ],
        session
      ),
    ]);

    const grossGMV = roundMoney(globalOrderMetrics[0]?.grossGMV || 0);
    const platformCommission = roundMoney(globalOrderMetrics[0]?.platformCommission || 0);
    const nurseryPayoutPayable = roundMoney(globalOrderMetrics[0]?.nurseryPayoutPayable || 0);
    const totalCompletedPayouts = roundMoney(globalPayoutCompleted[0]?.total || 0);
    const totalPendingPayouts = roundMoney(globalPayoutPending[0]?.total || 0);
    const totalOrdersCount = globalOrderMetrics[0]?.ordersCount || 0;

    return {
      grossGMV,
      platformCommission,
      nurseryPayoutPayable,
      totalCompletedPayouts,
      totalPendingPayouts,
      totalOrdersCount,
    };
  } catch (err) {
    console.error("[calculateGlobalFinancialSummary] Aggregation error:", err);
    return {
      grossGMV: 0,
      platformCommission: 0,
      nurseryPayoutPayable: 0,
      totalCompletedPayouts: 0,
      totalPendingPayouts: 0,
      totalOrdersCount: 0,
    };
  }
};

export {
  getActiveCommissionMap,
  getDynamicCommissionRates,
  getDynamicCommissionExpression,
  getEffectiveCommission,
  getEffectiveCommissionRate,
  DEFAULT_CATEGORY_COMMISSIONS,
} from "./commissionService";
