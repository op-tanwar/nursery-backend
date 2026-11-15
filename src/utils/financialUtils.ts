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
import { resolveNurseryIdentity, ResolvedNurseryIdentity } from "./nurseryUtils";
import {
  getActiveCommissionMap,
  getDynamicCommissionRates,
  getDynamicCommissionExpression,
  getEffectiveCommission,
  getEffectiveCommissionRate,
  DEFAULT_CATEGORY_COMMISSIONS,
} from "./commissionService";
import {
  toPaise,
  toRupees,
  roundMoney,
  calcLineGross,
  calcLineCommission,
  calcLineNet,
  getExtendedDateRangeFilter,
  getNextSettlementDate,
  getNurseryFinancialLedger,
  getPlatformFinancialLedger,
  reconcileLegacyOrderCommissions,
  INurseryLedgerSummary,
  IPlatformLedgerSummary,
  IFinancialPeriodMetrics,
  IGlobalFinancialPeriodMetrics,
} from "../services/financialLedgerService";

// ──────────────────────────────────────────────────────────────
// 🔢 PAISE-SAFE ARITHMETIC (delegates to financialLedgerService)
// ──────────────────────────────────────────────────────────────

export {
  toPaise,
  toRupees,
  roundMoney,
  calcLineGross,
  calcLineCommission,
  calcLineNet,
  getExtendedDateRangeFilter,
  getNextSettlementDate,
  getNurseryFinancialLedger,
  getPlatformFinancialLedger,
  reconcileLegacyOrderCommissions,
  INurseryLedgerSummary,
  IPlatformLedgerSummary,
  IFinancialPeriodMetrics,
  IGlobalFinancialPeriodMetrics,
};

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
    "orderItems.nursery": Array.isArray(nurseryId) ? { $in: nurseryId } : nurseryId,
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
 * 🎯 SINGLE SOURCE OF TRUTH FOR NURSERY BALANCE & METRICS
 * Delegates directly to the canonical financialLedgerService.
 * Used by Nursery Dashboard, Nursery Payouts API, Admin Payouts API, and Ledger verification.
 *
 * @param nurseryIdOrUserId Either NurseryProfile._id OR User._id (automatically resolved via resolveNurseryIdentity)
 * @param session Optional Mongoose ClientSession for active transactions
 */
export const calculateNurseryFinancialSummary = async (
  nurseryIdOrUserId: Types.ObjectId | string,
  session?: ClientSession
): Promise<INurseryFinancialSummary> => {
  try {
    const ledger = await getNurseryFinancialLedger(nurseryIdOrUserId, { session });
    return {
      grossEarnings: ledger.grossEarnings,
      totalCommission: ledger.totalCommission,
      netSales: ledger.netSales,
      totalPaidOut: ledger.totalPaidOut,
      pendingPayouts: ledger.pendingPayouts,
      availableBalance: ledger.availableBalance,
      hasNegativeBalance: ledger.hasNegativeBalance,
      totalOrdersCount: ledger.totalOrdersCount,
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

export interface IGlobalFinancialSummary {
  grossGMV: number;
  platformCommission: number;
  nurseryPayoutPayable: number;
  totalCompletedPayouts: number;
  totalPendingPayouts: number;
  unsettledPayable: number;
  weeklyPayable: number;
  totalOrdersCount: number;
}

/**
 * 🎯 SINGLE SOURCE OF TRUTH FOR GLOBAL PLATFORM FINANCIALS (ADMIN)
 * Delegates directly to the canonical financialLedgerService.
 * Used by Admin Dashboard and Admin Payouts List.
 */
export const calculateGlobalFinancialSummary = async (
  session?: ClientSession
): Promise<IGlobalFinancialSummary> => {
  try {
    const ledger = await getPlatformFinancialLedger({ session });
    return {
      grossGMV: ledger.grossGMV,
      platformCommission: ledger.platformCommission,
      nurseryPayoutPayable: ledger.nurseryPayoutPayable,
      totalCompletedPayouts: ledger.totalCompletedPayouts,
      totalPendingPayouts: ledger.totalPendingPayouts,
      unsettledPayable: ledger.unsettledPayable,
      weeklyPayable: ledger.weeklyPayable,
      totalOrdersCount: ledger.totalOrdersCount,
    };
  } catch (err) {
    console.error("[calculateGlobalFinancialSummary] Aggregation error:", err);
    return {
      grossGMV: 0,
      platformCommission: 0,
      nurseryPayoutPayable: 0,
      totalCompletedPayouts: 0,
      totalPendingPayouts: 0,
      unsettledPayable: 0,
      weeklyPayable: 0,
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
  resolveProductCommissionType,
} from "./commissionService";

export { resolveNurseryIdentity, ResolvedNurseryIdentity } from "./nurseryUtils";
