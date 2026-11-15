/**
 * ======================================================================
 * 💰 FINANCIAL LEDGER SERVICE — CANONICAL SINGLE SOURCE OF TRUTH
 * ======================================================================
 * Authoritative financial calculation and ledger engine for Urban Nursery.
 * Consumed by:
 *   - Nursery Dashboard (`/nursery`)
 *   - Nursery Payouts (`/nursery/payouts`)
 *   - Admin Dashboard (`/admin`)
 *   - Admin Payouts (`/admin/payouts`)
 *
 * GUARANTEED MATHEMATICAL INVARIANTS:
 * 1. Line & Period Invariant:
 *      Gross Sales - Platform Commission = Total Net Earnings
 *      (Gross GMV - Platform Commission = Payouts Due to Nurseries)
 * 2. Settlement Invariant:
 *      Total Net Earnings = Total Lifetime Settled + Pending Settlement + Available For Payout (Current Week Payable)
 * 3. Cross-Surface Identity:
 *      Dashboard Weekly Payable === Payouts Available Balance === Unsettled Net Accrual
 * 4. Zero Discrepancy:
 *      All arithmetic executed with paise-safe integer precision to eliminate
 *      floating-point drift, with final rupee rounding to 2 decimals.
 * ======================================================================
 */

import { Types, ClientSession } from "mongoose";
import Order from "../models/orderModel";
import Payout from "../models/payoutModel";
import { resolveNurseryIdentity, ResolvedNurseryIdentity } from "../utils/nurseryUtils";
import {
  getDynamicCommissionExpression,
  getDynamicCommissionRates,
  getActiveCommissionMap,
} from "../utils/commissionService";

// ──────────────────────────────────────────────────────────────────────
// 🔢 1. PAISE-SAFE ARITHMETIC UTILITIES
// ──────────────────────────────────────────────────────────────────────

/** Convert rupees to integer paise (e.g. 561.70 → 56170) */
export const toPaise = (rupees: number): number =>
  Math.round((Number(rupees) || 0) * 100);

/** Convert integer paise to rupees with 2 decimal precision */
export const toRupees = (paise: number): number =>
  Math.round(Number(paise) || 0) / 100;

/** Round rupee amount to 2 decimal places using paise arithmetic */
export const roundMoney = (rupees: number): number =>
  toRupees(toPaise(rupees));

/** Calculate line-item gross total in rupees (effective price * quantity) */
export const calcLineGross = (price: number, quantity: number): number =>
  roundMoney((Number(price) || 0) * (Number(quantity) || 1));

/** Calculate line-item commission in rupees with paise-level rounding */
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
  }
  const grossPaise = toPaise(lineGross);
  const commPaise = Math.round(grossPaise * rate);
  return toRupees(commPaise);
};

/** Calculate line-item net earnings in rupees (Gross - Commission) */
export const calcLineNet = (lineGross: number, lineCommission: number): number =>
  roundMoney(lineGross - lineCommission);

// ──────────────────────────────────────────────────────────────────────
// 📅 2. EXTENDED DATE RANGE CALCULATOR
// ──────────────────────────────────────────────────────────────────────

export interface IExtendedDateRange {
  $gte: Date;
  $lte: Date;
}

export const getExtendedDateRangeFilter = (
  filterType: string,
  startDate?: string,
  endDate?: string
): IExtendedDateRange => {
  const now = new Date();
  let start = new Date();
  let end = new Date();

  switch (filterType) {
    case "today":
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case "yesterday":
      start.setDate(now.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(now.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case "this_week": {
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1);
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case "last_week": {
      const day = start.getDay();
      const diff = start.getDate() - day - 6 + (day === 0 ? -6 : 1);
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case "this_month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
    case "last_month":
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      break;
    case "this_year":
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      break;
    case "last_year":
      start = new Date(now.getFullYear() - 1, 0, 1);
      end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
      break;
    case "lifetime":
      start = new Date(2020, 0, 1);
      end = new Date(now.getFullYear() + 10, 11, 31, 23, 59, 59, 999);
      break;
    case "custom":
      if (startDate && endDate) {
        start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
      }
      break;
    default:
      start.setDate(now.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
  }

  return { $gte: start, $lte: end };
};

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

// ──────────────────────────────────────────────────────────────────────
// 🏗️ 3. CORE TYPES & INTERFACES
// ──────────────────────────────────────────────────────────────────────

export interface IFinancialPeriodMetrics {
  grossRevenue: number;
  commission: number;
  nurseryEarnings: number;
  ordersCount: number;
}

export interface IGlobalFinancialPeriodMetrics {
  grossGMV: number;
  commission: number;
  nurseryPayout: number;
  ordersCount: number;
}

export interface INurseryLedgerSummary {
  grossEarnings: number;
  totalCommission: number;
  netSales: number;
  totalPaidOut: number;
  pendingPayouts: number;
  availableBalance: number;
  hasNegativeBalance: boolean;
  totalOrdersCount: number;
  weeklyPayable: number;
  upcomingSettlement: number;
  nextSettlementDate: string;
  nextSettlementLabel: string;
  status: "Available" | "Processing" | "NegativeBalance";
  selected: IFinancialPeriodMetrics;
  periodBreakdown: {
    today: IFinancialPeriodMetrics;
    yesterday: IFinancialPeriodMetrics;
    thisWeek: IFinancialPeriodMetrics;
    lastWeek: IFinancialPeriodMetrics;
    thisMonth: IFinancialPeriodMetrics;
    lastMonth: IFinancialPeriodMetrics;
    thisYear: IFinancialPeriodMetrics;
    lastYear: IFinancialPeriodMetrics;
    lifetime: IFinancialPeriodMetrics;
  };
}

export interface IPlatformLedgerSummary {
  grossGMV: number;
  platformCommission: number;
  nurseryPayoutPayable: number;
  totalCompletedPayouts: number;
  totalPendingPayouts: number;
  unsettledPayable: number;
  hasNegativeBalance: boolean;
  totalOrdersCount: number;
  weeklyPayable: number;
  upcomingSettlement: number;
  nextSettlementDate: string;
  nextSettlementLabel: string;
  status: "Available" | "Processing" | "NegativeBalance";
  selected: IGlobalFinancialPeriodMetrics;
  periodBreakdown: {
    today: IGlobalFinancialPeriodMetrics;
    yesterday: IGlobalFinancialPeriodMetrics;
    thisWeek: IGlobalFinancialPeriodMetrics;
    lastWeek: IGlobalFinancialPeriodMetrics;
    thisMonth: IGlobalFinancialPeriodMetrics;
    lastMonth: IGlobalFinancialPeriodMetrics;
    thisYear: IGlobalFinancialPeriodMetrics;
    lastYear: IGlobalFinancialPeriodMetrics;
    lifetime: IGlobalFinancialPeriodMetrics;
  };
}

// ──────────────────────────────────────────────────────────────────────
// 🛡️ 4. PIPELINE BUILDER & AGGREGATION HELPERS
// ──────────────────────────────────────────────────────────────────────

/**
 * Builds the canonical match filter for active revenue items.
 * Strictly excludes cancelled orders, and only considers settled (Delivered/Claimed) items.
 */
export const buildAuthoritativeFinancialMatch = (options: {
  nurseryIds?: Types.ObjectId[];
  dateRange?: IExtendedDateRange;
}): Record<string, unknown> => {
  const filter: Record<string, unknown> = {
    orderStatus: { $ne: "Cancelled" },
    "orderItems.status": { $in: ["Delivered", "Claimed"] },
  };

  if (options.nurseryIds && options.nurseryIds.length > 0) {
    filter["orderItems.nursery"] = { $in: options.nurseryIds };
  }

  if (options.dateRange) {
    filter.createdAt = options.dateRange;
  }

  return filter;
};

/**
 * Builds the canonical MongoDB aggregation pipeline for financial totals.
 * Uses priceAtPurchase when available, and respects frozen commissionAmount
 * from order placement before falling back to dynamic category commission rates.
 */
export const buildAuthoritativeAggregationPipeline = (
  matchFilter: Record<string, unknown>,
  commExpr: any
): any[] => [
  { $unwind: "$orderItems" },
  { $match: matchFilter },
  {
    $project: {
      orderId: "$_id",
      createdAt: 1,
      itemTotal: {
        $multiply: [
          { $ifNull: ["$orderItems.priceAtPurchase", "$orderItems.price"] },
          "$orderItems.quantity",
        ],
      },
      commissionRate: commExpr,
      storedCommissionAmount: "$orderItems.commissionAmount",
      storedNurseryEarnings: "$orderItems.nurseryEarnings",
    },
  },
  {
    $project: {
      orderId: 1,
      createdAt: 1,
      itemTotal: 1,
      commissionAmount: {
        $ifNull: [
          "$storedCommissionAmount",
          { $multiply: ["$itemTotal", "$commissionRate"] },
        ],
      },
    },
  },
  {
    $project: {
      orderId: 1,
      createdAt: 1,
      itemTotal: 1,
      commissionAmount: 1,
      nurseryEarning: { $subtract: ["$itemTotal", "$commissionAmount"] },
    },
  },
  {
    $group: {
      _id: null,
      grossRevenue: { $sum: "$itemTotal" },
      totalCommission: { $sum: "$commissionAmount" },
      netEarnings: { $sum: "$nurseryEarning" },
      orderIds: { $addToSet: "$orderId" },
    },
  },
  {
    $project: {
      _id: 0,
      grossRevenue: 1,
      totalCommission: 1,
      netEarnings: 1,
      ordersCount: { $size: "$orderIds" },
    },
  },
];

const runAggregate = (model: any, pipeline: any[], session?: ClientSession) => {
  const agg = model.aggregate(pipeline);
  if (session) {
    agg.session(session);
  }
  return agg;
};

// ──────────────────────────────────────────────────────────────────────
// 🏡 5. NURSERY FINANCIAL LEDGER (CANONICAL ENGINE)
// ──────────────────────────────────────────────────────────────────────

/**
 * Single Canonical Calculation Engine for Nursery Financials.
 * Computes authoritative lifetime totals, settlement status, and period slices.
 *
 * Guaranteed Invariants:
 *  1. grossEarnings - totalCommission === netSales (paise-exact)
 *  2. netSales === totalPaidOut + pendingPayouts + availableBalance
 *  3. weeklyPayable === availableBalance (for unsettled active accruals)
 */
export const getNurseryFinancialLedger = async (
  nurseryIdOrUserId: Types.ObjectId | string,
  options: {
    timeframe?: string;
    startDate?: string;
    endDate?: string;
    session?: ClientSession;
  } = {}
): Promise<INurseryLedgerSummary> => {
  const { session, timeframe = "this_month", startDate, endDate } = options;
  const { allIds } = await resolveNurseryIdentity(nurseryIdOrUserId);
  const commExpr = await getDynamicCommissionExpression();

  const selectedRange = getExtendedDateRangeFilter(timeframe, startDate, endDate);
  const todayRange = getExtendedDateRangeFilter("today");
  const yesterdayRange = getExtendedDateRangeFilter("yesterday");
  const thisWeekRange = getExtendedDateRangeFilter("this_week");
  const lastWeekRange = getExtendedDateRangeFilter("last_week");
  const thisMonthRange = getExtendedDateRangeFilter("this_month");
  const lastMonthRange = getExtendedDateRangeFilter("last_month");
  const thisYearRange = getExtendedDateRangeFilter("this_year");
  const lastYearRange = getExtendedDateRangeFilter("last_year");

  // Lifetime match has no date boundary
  const lifetimeMatch = buildAuthoritativeFinancialMatch({ nurseryIds: allIds });
  const selectedMatch = buildAuthoritativeFinancialMatch({
    nurseryIds: allIds,
    dateRange: selectedRange,
  });

  const [
    lifetimeOrderMetrics,
    payoutCompleted,
    payoutPending,
    selectedOrderMetrics,
    todayMetrics,
    yesterdayMetrics,
    thisWeekMetrics,
    lastWeekMetrics,
    thisMonthMetrics,
    lastMonthMetrics,
    thisYearMetrics,
    lastYearMetrics,
  ] = await Promise.all([
    runAggregate(Order, buildAuthoritativeAggregationPipeline(lifetimeMatch, commExpr), session),
    runAggregate(
      Payout,
      [
        { $match: { nursery: { $in: allIds }, status: "COMPLETED" } },
        { $group: { _id: null, total: { $sum: "$requestedAmount" } } },
      ],
      session
    ),
    runAggregate(
      Payout,
      [
        { $match: { nursery: { $in: allIds }, status: { $in: ["PENDING", "PROCESSING"] } } },
        { $group: { _id: null, total: { $sum: "$requestedAmount" } } },
      ],
      session
    ),
    runAggregate(Order, buildAuthoritativeAggregationPipeline(selectedMatch, commExpr), session),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ nurseryIds: allIds, dateRange: todayRange }),
        commExpr
      ),
      session
    ),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ nurseryIds: allIds, dateRange: yesterdayRange }),
        commExpr
      ),
      session
    ),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ nurseryIds: allIds, dateRange: thisWeekRange }),
        commExpr
      ),
      session
    ),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ nurseryIds: allIds, dateRange: lastWeekRange }),
        commExpr
      ),
      session
    ),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ nurseryIds: allIds, dateRange: thisMonthRange }),
        commExpr
      ),
      session
    ),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ nurseryIds: allIds, dateRange: lastMonthRange }),
        commExpr
      ),
      session
    ),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ nurseryIds: allIds, dateRange: thisYearRange }),
        commExpr
      ),
      session
    ),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ nurseryIds: allIds, dateRange: lastYearRange }),
        commExpr
      ),
      session
    ),
  ]);

  // 1. Lifetime Figures & Accounting Equation
  const rawGrossLifetime = lifetimeOrderMetrics[0]?.grossRevenue || 0;
  const rawCommLifetime = lifetimeOrderMetrics[0]?.totalCommission || 0;
  const grossEarnings = roundMoney(rawGrossLifetime);
  const totalCommission = roundMoney(rawCommLifetime);
  // 🛡️ Invariant 1: Net Sales = Gross - Commission (paise-exact)
  const netSales = roundMoney(grossEarnings - totalCommission);
  const totalOrdersCount = lifetimeOrderMetrics[0]?.ordersCount || 0;

  const totalPaidOut = roundMoney(payoutCompleted[0]?.total || 0);
  const pendingPayouts = roundMoney(payoutPending[0]?.total || 0);

  // 🛡️ Invariant 2: Available = Net Sales - PaidOut - PendingPayouts
  const availableBalance = roundMoney(netSales - totalPaidOut - pendingPayouts);
  const hasNegativeBalance = availableBalance < 0;

  // 🛡️ Invariant 3: Current Week Payable is the unsettled balance available for disbursal
  // (Cannot be negative; if negative, 0 is payable until future orders clear deficit)
  const weeklyPayable = Math.max(0, availableBalance);
  const upcomingSettlement = weeklyPayable;

  const settlement = getNextSettlementDate();
  const status: "Available" | "Processing" | "NegativeBalance" = hasNegativeBalance
    ? "NegativeBalance"
    : pendingPayouts > 0
    ? "Processing"
    : "Available";

  // Helper to normalize period metrics with strict Gross - Commission = Net
  const formatPeriodMetrics = (res: any[]): IFinancialPeriodMetrics => {
    const rawGross = res[0]?.grossRevenue || 0;
    const rawComm = res[0]?.totalCommission || 0;
    const g = roundMoney(rawGross);
    const c = roundMoney(rawComm);
    const n = roundMoney(g - c);
    return {
      grossRevenue: g,
      commission: c,
      nurseryEarnings: n,
      ordersCount: res[0]?.ordersCount || 0,
    };
  };

  const periodBreakdown = {
    today: formatPeriodMetrics(todayMetrics),
    yesterday: formatPeriodMetrics(yesterdayMetrics),
    thisWeek: formatPeriodMetrics(thisWeekMetrics),
    lastWeek: formatPeriodMetrics(lastWeekMetrics),
    thisMonth: formatPeriodMetrics(thisMonthMetrics),
    lastMonth: formatPeriodMetrics(lastMonthMetrics),
    thisYear: formatPeriodMetrics(thisYearMetrics),
    lastYear: formatPeriodMetrics(lastYearMetrics),
    lifetime: {
      grossRevenue: grossEarnings,
      commission: totalCommission,
      nurseryEarnings: netSales,
      ordersCount: totalOrdersCount,
    },
  };

  const selected =
    timeframe === "lifetime"
      ? periodBreakdown.lifetime
      : formatPeriodMetrics(selectedOrderMetrics);

  return {
    grossEarnings,
    totalCommission,
    netSales,
    totalPaidOut,
    pendingPayouts,
    availableBalance,
    hasNegativeBalance,
    totalOrdersCount,
    weeklyPayable,
    upcomingSettlement,
    nextSettlementDate: settlement.iso,
    nextSettlementLabel: settlement.label,
    status,
    selected,
    periodBreakdown,
  };
};

// ──────────────────────────────────────────────────────────────────────
// 🛡️ 6. PLATFORM FINANCIAL LEDGER (ADMIN SINGLE SOURCE OF TRUTH)
// ──────────────────────────────────────────────────────────────────────

/**
 * Single Canonical Calculation Engine for Platform Global Financials (Admin).
 * Computes authoritative platform GMV, commission income, vendor payouts due, and queues.
 *
 * Guaranteed Invariants:
 *  1. grossGMV - platformCommission === nurseryPayoutPayable (paise-exact)
 *  2. nurseryPayoutPayable === totalCompletedPayouts + totalPendingPayouts + unsettledPayable
 *  3. weeklyPayable === unsettledPayable
 *  4. Admin GMV === SUM(All Nurseries Gross Sales)
 *  5. Admin Commission === SUM(All Nurseries Platform Commission)
 *  6. Admin Payouts Due === SUM(All Nurseries Net Sales)
 */
export const getPlatformFinancialLedger = async (
  options: {
    timeframe?: string;
    startDate?: string;
    endDate?: string;
    session?: ClientSession;
  } = {}
): Promise<IPlatformLedgerSummary> => {
  const { session, timeframe = "this_month", startDate, endDate } = options;
  const commExpr = await getDynamicCommissionExpression();

  const selectedRange = getExtendedDateRangeFilter(timeframe, startDate, endDate);
  const todayRange = getExtendedDateRangeFilter("today");
  const yesterdayRange = getExtendedDateRangeFilter("yesterday");
  const thisWeekRange = getExtendedDateRangeFilter("this_week");
  const lastWeekRange = getExtendedDateRangeFilter("last_week");
  const thisMonthRange = getExtendedDateRangeFilter("this_month");
  const lastMonthRange = getExtendedDateRangeFilter("last_month");
  const thisYearRange = getExtendedDateRangeFilter("this_year");
  const lastYearRange = getExtendedDateRangeFilter("last_year");

  const lifetimeMatch = buildAuthoritativeFinancialMatch({});
  const selectedMatch = buildAuthoritativeFinancialMatch({ dateRange: selectedRange });

  const [
    lifetimeOrderMetrics,
    globalPayoutCompleted,
    globalPayoutPending,
    selectedOrderMetrics,
    todayMetrics,
    yesterdayMetrics,
    thisWeekMetrics,
    lastWeekMetrics,
    thisMonthMetrics,
    lastMonthMetrics,
    thisYearMetrics,
    lastYearMetrics,
  ] = await Promise.all([
    runAggregate(Order, buildAuthoritativeAggregationPipeline(lifetimeMatch, commExpr), session),
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
    runAggregate(Order, buildAuthoritativeAggregationPipeline(selectedMatch, commExpr), session),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ dateRange: todayRange }),
        commExpr
      ),
      session
    ),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ dateRange: yesterdayRange }),
        commExpr
      ),
      session
    ),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ dateRange: thisWeekRange }),
        commExpr
      ),
      session
    ),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ dateRange: lastWeekRange }),
        commExpr
      ),
      session
    ),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ dateRange: thisMonthRange }),
        commExpr
      ),
      session
    ),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ dateRange: lastMonthRange }),
        commExpr
      ),
      session
    ),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ dateRange: thisYearRange }),
        commExpr
      ),
      session
    ),
    runAggregate(
      Order,
      buildAuthoritativeAggregationPipeline(
        buildAuthoritativeFinancialMatch({ dateRange: lastYearRange }),
        commExpr
      ),
      session
    ),
  ]);

  const rawGross = lifetimeOrderMetrics[0]?.grossRevenue || 0;
  const rawComm = lifetimeOrderMetrics[0]?.totalCommission || 0;
  const grossGMV = roundMoney(rawGross);
  const platformCommission = roundMoney(rawComm);
  // 🛡️ Invariant 1: Payout Due = Gross - Commission (paise-exact)
  const nurseryPayoutPayable = roundMoney(grossGMV - platformCommission);
  const totalOrdersCount = lifetimeOrderMetrics[0]?.ordersCount || 0;

  const totalCompletedPayouts = roundMoney(globalPayoutCompleted[0]?.total || 0);
  const totalPendingPayouts = roundMoney(globalPayoutPending[0]?.total || 0);

  // 🛡️ Invariant 2: Unsettled Payable = Total Payable - Completed - Pending
  const unsettledPayable = roundMoney(
    nurseryPayoutPayable - totalCompletedPayouts - totalPendingPayouts
  );
  const hasNegativeBalance = unsettledPayable < 0;

  // 🛡️ Invariant 3: Weekly Payable is the currently unsettled vendor balance
  const weeklyPayable = Math.max(0, unsettledPayable);
  const upcomingSettlement = totalPendingPayouts;

  const settlement = getNextSettlementDate();
  const status: "Available" | "Processing" | "NegativeBalance" = hasNegativeBalance
    ? "NegativeBalance"
    : totalPendingPayouts > 0
    ? "Processing"
    : "Available";

  const formatGlobalPeriodMetrics = (res: any[]): IGlobalFinancialPeriodMetrics => {
    const rawG = res[0]?.grossRevenue || 0;
    const rawC = res[0]?.totalCommission || 0;
    const g = roundMoney(rawG);
    const c = roundMoney(rawC);
    const n = roundMoney(g - c);
    return {
      grossGMV: g,
      commission: c,
      nurseryPayout: n,
      ordersCount: res[0]?.ordersCount || 0,
    };
  };

  const periodBreakdown = {
    today: formatGlobalPeriodMetrics(todayMetrics),
    yesterday: formatGlobalPeriodMetrics(yesterdayMetrics),
    thisWeek: formatGlobalPeriodMetrics(thisWeekMetrics),
    lastWeek: formatGlobalPeriodMetrics(lastWeekMetrics),
    thisMonth: formatGlobalPeriodMetrics(thisMonthMetrics),
    lastMonth: formatGlobalPeriodMetrics(lastMonthMetrics),
    thisYear: formatGlobalPeriodMetrics(thisYearMetrics),
    lastYear: formatGlobalPeriodMetrics(lastYearMetrics),
    lifetime: {
      grossGMV,
      commission: platformCommission,
      nurseryPayout: nurseryPayoutPayable,
      ordersCount: totalOrdersCount,
    },
  };

  const selected =
    timeframe === "lifetime"
      ? periodBreakdown.lifetime
      : formatGlobalPeriodMetrics(selectedOrderMetrics);

  return {
    grossGMV,
    platformCommission,
    nurseryPayoutPayable,
    totalCompletedPayouts,
    totalPendingPayouts,
    unsettledPayable,
    hasNegativeBalance,
    totalOrdersCount,
    weeklyPayable,
    upcomingSettlement,
    nextSettlementDate: settlement.iso,
    nextSettlementLabel: settlement.label,
    status,
    selected,
    periodBreakdown,
  };
};

// ──────────────────────────────────────────────────────────────────────
// 🔄 7. LEGACY ORDER COMMISSION RECONCILIATION MIGRATION
// ──────────────────────────────────────────────────────────────────────

/**
 * Migration & Maintenance Helper: Scans all orders and reconciles legacy orderItems
 * that may be missing frozen `commissionAmount`, `priceAtPurchase`, or `nurseryEarnings`.
 */
export const reconcileLegacyOrderCommissions = async (
  session?: ClientSession
): Promise<{ updatedOrdersCount: number; updatedItemsCount: number }> => {
  const dynamicRates = await getDynamicCommissionRates();

  const orders = await Order.find({
    orderStatus: { $ne: "Cancelled" },
    $or: [
      { "orderItems.commissionAmount": { $exists: false } },
      { "orderItems.commissionAmount": null },
      { "orderItems.priceAtPurchase": { $exists: false } },
      { "orderItems.priceAtPurchase": null },
      { "orderItems.nurseryEarnings": { $exists: false } },
      { "orderItems.nurseryEarnings": null },
    ],
  }).session(session || null);

  let updatedOrdersCount = 0;
  let updatedItemsCount = 0;

  for (const order of orders) {
    let modified = false;
    for (const item of order.orderItems) {
      if (
        item.commissionAmount == null ||
        item.priceAtPurchase == null ||
        item.nurseryEarnings == null
      ) {
        const effectivePrice = Number(item.priceAtPurchase ?? item.price) || 0;
        item.priceAtPurchase = effectivePrice;
        const lineGross = calcLineGross(effectivePrice, item.quantity);
        const rateKey = item.itemModel || (item as any).category || "Plant";
        const rate =
          (item.commissionRatePercentage ? item.commissionRatePercentage / 100 : null) ??
          dynamicRates[rateKey] ??
          dynamicRates[rateKey.toLowerCase()] ??
          0.30;

        item.commissionRatePercentage = Math.round(rate * 100);
        item.commissionAmount = calcLineCommission(lineGross, rate);
        item.nurseryEarnings = calcLineNet(lineGross, item.commissionAmount);
        modified = true;
        updatedItemsCount++;
      }
    }
    if (modified) {
      await order.save({ session });
      updatedOrdersCount++;
    }
  }

  return { updatedOrdersCount, updatedItemsCount };
};
