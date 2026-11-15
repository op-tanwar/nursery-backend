import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import Order from "../models/orderModel";
import Product from "../models/productModel";
import User from "../models/userModel";
import Payout from "../models/payoutModel";
import { getCaseInsensitiveModel } from "../utils/productRegistry";
import {
  roundMoney,
  toPaise,
  toRupees,
  calcLineGross,
  calcLineCommission,
  calcLineNet,
  getNextSettlementDate,
  getDynamicCommissionExpression,
  getDynamicCommissionRates,
  getActiveCommissionMap,
  getCommissionRate,
  calculateNurseryFinancialSummary,
  calculateGlobalFinancialSummary,
  getNurseryFinancialLedger,
  getPlatformFinancialLedger,
  getExtendedDateRangeFilter,
  resolveNurseryIdentity,
} from "../utils/financialUtils";
import cacheManager from "../utils/cacheManager";


// ======================================================================
// 📐 TYPES & HELPERS
// ======================================================================
export interface IExtendedDateRange {
  $gte: Date;
  $lte: Date;
}

export interface IPeriodMetrics {
  grossRevenue: number;
  commission: number;
  nurseryEarnings: number;
  ordersCount: number;
}

export interface IGlobalPeriodMetrics {
  grossGMV: number;
  commission: number;
  nurseryPayout: number;
  ordersCount: number;
}



// Delegate settlement date to centralized utility
const formatSettlementDate = getNextSettlementDate;

const CATEGORY_LIST = [
  "Plant",
  "Pot",
  "Accessory",
  "GardeningTool",
  "PlantCare",
  "SeedsBulbs",
  "PlantStandsShelves",
  "ArtificialDriedPlant",
] as const;

const roundPeriodMetrics = (m: IPeriodMetrics): IPeriodMetrics => ({
  grossRevenue: roundMoney(m.grossRevenue),
  commission: roundMoney(m.commission),
  nurseryEarnings: roundMoney(m.nurseryEarnings),
  ordersCount: m.ordersCount || 0,
});

const roundGlobalPeriodMetrics = (m: IGlobalPeriodMetrics): IGlobalPeriodMetrics => ({
  grossGMV: roundMoney(m.grossGMV),
  commission: roundMoney(m.commission),
  nurseryPayout: roundMoney(m.nurseryPayout),
  ordersCount: m.ordersCount || 0,
});

const stockCountPipeline = (nurseryFilter: Record<string, any>) => [
  { $match: nurseryFilter },
  {
    $group: {
      _id: null,
      total: { $sum: 1 },
      lowStock: { $sum: { $cond: [{ $lt: ["$stock", 10] }, 1, 0] } },
      outOfStock: { $sum: { $cond: [{ $eq: ["$stock", 0] }, 1, 0] } },
    },
  },
];

const emptyStockMeta = () => ({ total: 0, lowStock: 0, outOfStock: 0 });

const mapLowStockRows = (
  rows: Array<{ _id: Types.ObjectId; name: string; stock: number; price: number }>,
  type: string
) =>
  rows.map((i) => ({
    _id: i._id.toString(),
    name: i.name,
    stock: i.stock,
    price: roundMoney(i.price),
    type,
    stockStatus:
      i.stock === 0 ? ("out_of_stock" as const) : ("low_stock" as const),
  }));


interface IMappedOrderLine {
  name: string;
  quantity: number;
  category: (typeof CATEGORY_LIST)[number];
  unitPrice: number;
  lineGross: number;
  lineCommission: number;
  lineNet: number;
  label: string;
}

const mapOrderLines = async (
  items: Array<{
    item: Types.ObjectId | string;
    itemModel: string;
    quantity: number;
    price: number;
    priceAtPurchase?: number;
    commissionRatePercentage?: number;
    commissionAmount?: number;
    nurseryEarnings?: number;
  }>
): Promise<IMappedOrderLine[]> =>
  Promise.all(
    items.map(async (item) => {
      const name = await resolveProductName(item.item, item.itemModel);
      const effectivePrice = Number(item.priceAtPurchase ?? item.price) || 0;
      const lineGross = calcLineGross(effectivePrice, item.quantity);
      const rate =
        item.commissionRatePercentage != null
          ? item.commissionRatePercentage / 100
          : await getCommissionRate(item.itemModel);
      const lineCommission =
        item.commissionAmount != null
          ? roundMoney(item.commissionAmount)
          : calcLineCommission(lineGross, rate);
      const lineNet =
        item.nurseryEarnings != null
          ? roundMoney(item.nurseryEarnings)
          : calcLineNet(lineGross, lineCommission);
      const category = (CATEGORY_LIST.includes(
        item.itemModel as (typeof CATEGORY_LIST)[number]
      )
        ? item.itemModel
        : "Accessory") as (typeof CATEGORY_LIST)[number];

      return {
        name,
        quantity: item.quantity,
        category,
        unitPrice: roundMoney(effectivePrice),
        lineGross,
        lineCommission,
        lineNet,
        label: `${item.quantity}x ${name}`,
      };
    })
  );

const ensureCategoryPerformance = (
  rows: Array<{
    category: string;
    commissionRate?: number;
    grossRevenue?: number;
    revenue?: number;
    orderCount?: number;
    ordersCount?: number;
    commission?: number;
    netEarnings?: number;
  }>,
  ratesMap: Record<string, number> = {}
) =>
  CATEGORY_LIST.map((category) => {
    const found = rows.find((r) => r.category === category);
    const gross = roundMoney(found?.grossRevenue ?? found?.revenue ?? 0);
    const commission = roundMoney(found?.commission ?? 0);
    const net = roundMoney(
      found?.netEarnings ?? gross - commission
    );
    const orders = found?.orderCount ?? found?.ordersCount ?? 0;
    const rate = ratesMap[category] ?? 0.30;
    return {
      category,
      commissionRate: rate,
      grossRevenue: gross,
      revenue: gross,
      orderCount: orders,
      ordersCount: orders,
      commission,
      netEarnings: net,
    };
  });


const emptyPeriodMetrics = (): IPeriodMetrics => ({
  grossRevenue: 0,
  commission: 0,
  nurseryEarnings: 0,
  ordersCount: 0,
});

const emptyGlobalPeriodMetrics = (): IGlobalPeriodMetrics => ({
  grossGMV: 0,
  commission: 0,
  nurseryPayout: 0,
  ordersCount: 0,
});

const getPeriodStats = async (
  tf: string,
  nurseryId?: Types.ObjectId | Types.ObjectId[]
): Promise<IPeriodMetrics> => {
  if (!nurseryId) return emptyPeriodMetrics();
  const targetId = Array.isArray(nurseryId) ? nurseryId[0] : nurseryId;
  const ledger = await getNurseryFinancialLedger(targetId, { timeframe: tf });
  return ledger.selected;
};

const getGlobalPeriodStats = async (tf: string): Promise<IGlobalPeriodMetrics> => {
  const ledger = await getPlatformFinancialLedger({ timeframe: tf });
  return ledger.selected;
};


const resolveProductName = async (
  itemId: Types.ObjectId | string,
  itemModel?: string
): Promise<string> => {
  const cacheKey = `pname:${itemModel || "prod"}:${String(itemId)}`;
  const cached = await cacheManager.get<string>(cacheKey);
  if (cached) return cached;

  const doc = await Product.findById(itemId).select("name").lean();
  const name = (doc as any)?.name || "Unknown Product";
  await cacheManager.set(cacheKey, name, 600); // 10 min TTL
  return name;
};

// ======================================================================
// 🏡 1. NURSERY DASHBOARD CONTROLLER
// ======================================================================
export const getNurseryDashboardStats = catchAsyncErrors(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const userId = req.user?._id;
    if (!userId) {
      res.status(401).json({ success: false, message: "User context not found." });
      return;
    }

    const { profileId, allIds } = await resolveNurseryIdentity(userId);
    const nurseryId = profileId;
    const nurseryIds = allIds;
    const { timeframe = "this_month", startDate, endDate } = req.query;
    const dateRange = getExtendedDateRangeFilter(
      timeframe as string,
      startDate as string | undefined,
      endDate as string | undefined
    );

    // 🔑 Fetch dynamic commission expression and rates ONCE for this request
    const [commExpr, dynamicRates] = await Promise.all([
      getDynamicCommissionExpression(),
      getDynamicCommissionRates(),
    ]);

    const currentYear = new Date().getFullYear().toString();
    const lastYear = (new Date().getFullYear() - 1).toString();
    const nurseryMatch = {
      "orderItems.nursery": { $in: nurseryIds },
      createdAt: dateRange,
    };
    const nurseryFinancialMatch = {
      "orderItems.nursery": { $in: nurseryIds },
      createdAt: dateRange,
      orderStatus: { $ne: "Cancelled" },
      // 🛡️ SECURITY: Only SETTLED items (Delivered/Claimed) contribute to earnings.
      "orderItems.status": { $in: ["Delivered", "Claimed"] },
    };

    const [
      nurseryFinancials,
      categorySales,
      plantCounts,
      potCounts,
      accessoryCounts,
      gardeningToolCounts,
      plantCareCounts,
      seedsBulbsCounts,
      plantStandsCounts,
      artificialDriedPlantCounts,
      lowStockPlants,
      lowStockPots,
      lowStockAccessories,
      lowStockGardeningTools,
      lowStockPlantCare,
      lowStockSeedsBulbs,
      lowStockPlantStands,
      lowStockArtificialDriedPlants,
      recentOrders,
      topSellingRaw,
      statusDistribution,
      trendsRaw,
      itemsSoldAgg,
    ] = await Promise.all([
      getNurseryFinancialLedger(nurseryId, {
        timeframe: timeframe as string,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      }),

      Order.aggregate([
        { $unwind: "$orderItems" },
        { $match: nurseryFinancialMatch },
        {
          $project: {
            itemModel: "$orderItems.itemModel",
            itemTotal: {
              $multiply: [
                { $ifNull: ["$orderItems.priceAtPurchase", "$orderItems.price"] },
                "$orderItems.quantity",
              ],
            },
            commissionRate: commExpr,
            storedCommission: "$orderItems.commissionAmount",
            orderId: "$_id",
          },
        },
        {
          $project: {
            itemModel: 1,
            itemTotal: 1,
            orderId: 1,
            commission: {
              $ifNull: [
                "$storedCommission",
                { $multiply: ["$itemTotal", "$commissionRate"] },
              ],
            },
          },
        },
        {
          $group: {
            _id: "$itemModel",
            revenue: { $sum: "$itemTotal" },
            commission: { $sum: "$commission" },
            netEarnings: {
              $sum: { $subtract: ["$itemTotal", "$commission"] },
            },
            orders: { $addToSet: "$orderId" },
          },
        },
        {
          $project: {
            _id: 0,
            category: "$_id",
            revenue: 1,
            commission: 1,
            netEarnings: 1,
            ordersCount: { $size: "$orders" },
          },
        },
      ]),

      Product.aggregate(stockCountPipeline({ nursery: { $in: nurseryIds }, category: "plants" })),
      Product.aggregate(stockCountPipeline({ nursery: { $in: nurseryIds }, category: "pots" })),
      Product.aggregate(stockCountPipeline({ nursery: { $in: nurseryIds }, category: "accessories" })),
      Product.aggregate(stockCountPipeline({ nursery: { $in: nurseryIds }, category: "gardening-tools" })),
      Product.aggregate(stockCountPipeline({ nursery: { $in: nurseryIds }, category: "plant-care" })),
      Product.aggregate(stockCountPipeline({ nursery: { $in: nurseryIds }, category: "seeds-bulbs" })),
      Product.aggregate(stockCountPipeline({ nursery: { $in: nurseryIds }, category: { $in: ["plant-stands-shelves", "stands-shelves"] } })),
      Product.aggregate(stockCountPipeline({ nursery: { $in: nurseryIds }, category: "artificial-dried" })),

      Product.find({ nursery: { $in: nurseryIds }, category: "plants", stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      Product.find({ nursery: { $in: nurseryIds }, category: "pots", stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      Product.find({ nursery: { $in: nurseryIds }, category: "accessories", stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      Product.find({ nursery: { $in: nurseryIds }, category: "gardening-tools", stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      Product.find({ nursery: { $in: nurseryIds }, category: "plant-care", stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      Product.find({ nursery: { $in: nurseryIds }, category: "seeds-bulbs", stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      Product.find({ nursery: { $in: nurseryIds }, category: { $in: ["plant-stands-shelves", "stands-shelves"] }, stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      Product.find({ nursery: { $in: nurseryIds }, category: "artificial-dried", stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),

      Order.find({ "orderItems.nursery": { $in: nurseryIds } })
        .populate<{ user: { name: string; email: string } | null }>("user", "name email")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),

      Order.aggregate([
        { $unwind: "$orderItems" },
        { $match: nurseryFinancialMatch },
        {
          $group: {
            _id: "$orderItems.item",
            itemType: { $first: "$orderItems.itemModel" },
            quantitySold: { $sum: "$orderItems.quantity" },
            grossRevenue: {
              $sum: { $multiply: ["$orderItems.price", "$orderItems.quantity"] },
            },
            commission: {
              $sum: {
                $multiply: [
                  "$orderItems.price",
                  "$orderItems.quantity",
                  commExpr,
                ],
              },
            },
          },
        },
        {
          $project: {
            itemType: 1,
            quantitySold: 1,
            grossRevenue: 1,
            nurseryEarnings: { $subtract: ["$grossRevenue", "$commission"] },
          },
        },
        { $sort: { quantitySold: -1 } },
        { $limit: 10 },
      ]),

      Order.aggregate([
        { $unwind: "$orderItems" },
        { $match: nurseryMatch },
        { $group: { _id: "$orderItems.status", count: { $sum: 1 } } },
      ]),

      Order.aggregate([
        { $unwind: "$orderItems" },
        { $match: nurseryFinancialMatch },
        {
          $project: {
            createdAt: 1,
            orderId: "$_id",
            itemTotal: {
              $multiply: [
                { $ifNull: ["$orderItems.priceAtPurchase", "$orderItems.price"] },
                "$orderItems.quantity",
              ],
            },
            commissionRate: commExpr,
            storedCommission: "$orderItems.commissionAmount",
          },
        },
        {
          $project: {
            createdAt: 1,
            orderId: 1,
            itemTotal: 1,
            commission: {
              $ifNull: [
                "$storedCommission",
                { $multiply: ["$itemTotal", "$commissionRate"] },
              ],
            },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
            grossRevenue: { $sum: "$itemTotal" },
            netPayout: {
              $sum: { $subtract: ["$itemTotal", "$commission"] },
            },
            orders: { $addToSet: "$orderId" },
          },
        },
        {
          $project: {
            _id: 0,
            date: "$_id",
            grossRevenue: 1,
            netPayout: 1,
            ordersCount: { $size: "$orders" },
          },
        },
        { $sort: { date: 1 } },
      ]),

      Order.aggregate([
        { $unwind: "$orderItems" },
        { $match: nurseryFinancialMatch },
        {
          $group: {
            _id: null,
            totalItemsSold: { $sum: "$orderItems.quantity" },
          },
        },
      ]),
    ]);

    const selected = nurseryFinancials.selected;
    const pMeta = plantCounts[0] || emptyStockMeta();
    const potMeta = potCounts[0] || emptyStockMeta();
    const accMeta = accessoryCounts[0] || emptyStockMeta();
    const toolMeta = gardeningToolCounts[0] || emptyStockMeta();
    const careMeta = plantCareCounts[0] || emptyStockMeta();
    const seedsMeta = seedsBulbsCounts[0] || emptyStockMeta();
    const standsMeta = plantStandsCounts[0] || emptyStockMeta();
    const artificialDriedPlantMeta = artificialDriedPlantCounts[0] || emptyStockMeta();
    const statusMap: Record<string, number> = {
      Processing: 0,
      Packed: 0,
      Shipped: 0,
      Delivered: 0,
      Cancelled: 0,
      Returned: 0,
      Refunded: 0,
      Claimed: 0,
    };
    statusDistribution.forEach((s: { _id: string; count: number }) => {
      if (s._id in statusMap) statusMap[s._id] = s.count;
      else if (s._id === "Claimed") statusMap.Claimed = s.count;
    });

    const topSellingProducts = await Promise.all(
      topSellingRaw.map(
        async (p: {
          _id: Types.ObjectId;
          itemType: string;
          quantitySold: number;
          grossRevenue: number;
          nurseryEarnings: number;
        }) => ({
          _id: p._id.toString(),
          name: await resolveProductName(p._id, p.itemType),
          itemType: p.itemType,
          quantitySold: p.quantitySold,
          grossRevenue: roundMoney(p.grossRevenue),
          nurseryEarnings: roundMoney(p.nurseryEarnings),
        })
      )
    );

    const categoryPerformance = ensureCategoryPerformance(
      categorySales.map(
        (c: {
          category: string;
          revenue: number;
          commission: number;
          netEarnings: number;
          ordersCount: number;
        }) => ({
          category: c.category,
          grossRevenue: c.revenue,
          revenue: c.revenue,
          orderCount: c.ordersCount,
          ordersCount: c.ordersCount,
          commission: c.commission,
          netEarnings: c.netEarnings,
        })
      ),
      dynamicRates
    );


    const lowStockItems = [
      ...mapLowStockRows(lowStockPlants as any, "Plant"),
      ...mapLowStockRows(lowStockPots as any, "Pot"),
      ...mapLowStockRows(lowStockAccessories as any, "Accessory"),
      ...mapLowStockRows(lowStockGardeningTools as any, "GardeningTool"),
      ...mapLowStockRows(lowStockPlantCare as any, "PlantCare"),
      ...mapLowStockRows(lowStockSeedsBulbs as any, "SeedsBulbs"),
      ...mapLowStockRows(lowStockPlantStands as any, "PlantStandsShelves"),
      ...mapLowStockRows(lowStockArtificialDriedPlants as any, "ArtificialDriedPlant"),
    ];

    const nurseryIdsStr = (nurseryIds || []).map((id) => id.toString());
    const mappedRecentOrders = await Promise.all(
      recentOrders.map(async (o) => {
        const nurseryItems = (o.orderItems || []).filter(
          (item) => item.nursery && nurseryIdsStr.includes(item.nursery.toString())
        );
        const items = await mapOrderLines(nurseryItems);
        const gross = roundMoney(items.reduce((sum, line) => sum + line.lineGross, 0));
        const commission = roundMoney(
          items.reduce((sum, line) => sum + line.lineCommission, 0)
        );
        const paymentRaw = o.paymentInfo?.status || "Pending";
        const paymentStatus =
          paymentRaw === "Succeeded" || paymentRaw === "Paid"
            ? "Paid"
            : paymentRaw === "COD" || paymentRaw === "Cash on Delivery"
              ? "Cash on Delivery"
              : paymentRaw;

        return {
          orderId: o._id.toString(),
          customerName: o.user?.name || "Guest",
          items,
          itemsSummary: items.map((line) => line.label).join(", "),
          totalAmount: gross,
          adminCommission: commission,
          nurseryEarnings: roundMoney(gross - commission),
          orderStatus: o.orderStatus,
          paymentStatus,
          createdAt: o.createdAt,
        };
      })
    );

    const todayR = nurseryFinancials.periodBreakdown.today;
    const yesterdayR = nurseryFinancials.periodBreakdown.yesterday;
    const thisWeekR = nurseryFinancials.periodBreakdown.thisWeek;
    const lastWeekR = nurseryFinancials.periodBreakdown.lastWeek;
    const thisMonthR = nurseryFinancials.periodBreakdown.thisMonth;
    const lastMonthR = nurseryFinancials.periodBreakdown.lastMonth;
    const yearThisR = nurseryFinancials.periodBreakdown.thisYear;
    const yearLastR = nurseryFinancials.periodBreakdown.lastYear;
    const lifetimeR = nurseryFinancials.periodBreakdown.lifetime;

    const settlement = {
      iso: nurseryFinancials.nextSettlementDate,
      label: nurseryFinancials.nextSettlementLabel,
    };
    const totalPaidOut = nurseryFinancials.totalPaidOut;
    const pendingPayouts = nurseryFinancials.pendingPayouts;
    const availableBalance = nurseryFinancials.availableBalance;
    const hasNegativeBalance = nurseryFinancials.hasNegativeBalance;

    // Harmonize lifetime metrics with authoritative calculation
    lifetimeR.grossRevenue = nurseryFinancials.grossEarnings;
    lifetimeR.commission = nurseryFinancials.totalCommission;
    lifetimeR.nurseryEarnings = nurseryFinancials.netSales;
    lifetimeR.ordersCount = nurseryFinancials.totalOrdersCount;

    const totalProducts =

      pMeta.total +
      potMeta.total +
      accMeta.total +
      toolMeta.total +
      careMeta.total +
      seedsMeta.total +
      standsMeta.total +
      artificialDriedPlantMeta.total;
    const lowStockCount =
      pMeta.lowStock +
      potMeta.lowStock +
      accMeta.lowStock +
      toolMeta.lowStock +
      careMeta.lowStock +
      seedsMeta.lowStock +
      standsMeta.lowStock +
      artificialDriedPlantMeta.lowStock;
    const outOfStockCount =
      pMeta.outOfStock +
      potMeta.outOfStock +
      accMeta.outOfStock +
      toolMeta.outOfStock +
      careMeta.outOfStock +
      seedsMeta.outOfStock +
      standsMeta.outOfStock +
      artificialDriedPlantMeta.outOfStock;
    const healthyStockCount = Math.max(0, totalProducts - lowStockCount);

    const roundedTrends = trendsRaw.map(
      (t: {
        date: string;
        grossRevenue: number;
        netPayout: number;
        ordersCount?: number;
      }) => ({
        date: t.date,
        grossRevenue: roundMoney(t.grossRevenue),
        netPayout: roundMoney(t.netPayout),
        commission: roundMoney(t.grossRevenue - t.netPayout),
        ordersCount: t.ordersCount || 0,
      })
    );

    res.status(200).json({
      success: true,
      filterApplied: timeframe,
      commissionRates: {
        Plant: dynamicRates.Plant ?? 0.30,
        Pot: dynamicRates.Pot ?? 0.25,
        Accessory: dynamicRates.Accessory ?? 0.20,
        GardeningTool: dynamicRates.GardeningTool ?? 0.20,
        PlantCare: dynamicRates.PlantCare ?? 0.20,
        SeedsBulbs: dynamicRates.SeedsBulbs ?? 0.20,
        PlantStandsShelves: dynamicRates.PlantStandsShelves ?? 0.20,
        ArtificialDriedPlant: dynamicRates.ArtificialDriedPlant ?? 0.20,
      },
      metrics: {
        grossRevenue: selected.grossRevenue,
        commissionDeducted: selected.commission,
        netPayablePayout: selected.nurseryEarnings,
        totalOrders: selected.ordersCount,
        totalItemsSold: itemsSoldAgg[0]?.totalItemsSold || 0,
        inventorySummary: {
          totalProducts,
          plants: pMeta.total,
          pots: potMeta.total,
          accessories: accMeta.total,
          gardeningTools: toolMeta.total,
          plantCare: careMeta.total,
          seedsBulbs: seedsMeta.total,
          plantStands: standsMeta.total,
          artificialDriedPlants: artificialDriedPlantMeta.total,
          lowStockCount,
          outOfStockCount,
          healthyStockCount,
          inStockCount: Math.max(0, totalProducts - outOfStockCount),
        },
      },
      payouts: {
        // Real DB data from Payout model & authoritative ledger
        availableBalance,
        totalPaidOut,
        paidAmount: totalPaidOut,
        pendingPayouts,
        pendingPayout: pendingPayouts,
        hasNegativeBalance,
        // Canonical Golden Equation: Current Week Payable === Available Balance
        weeklyPayable: nurseryFinancials.weeklyPayable,
        grossLifetimeEarnings: nurseryFinancials.grossEarnings,
        netLifetimeEarnings: nurseryFinancials.netSales,
        totalCommissionLifetime: nurseryFinancials.totalCommission,
        upcomingSettlement: nurseryFinancials.upcomingSettlement,
        nextSettlementDate: settlement.iso,
        nextSettlementLabel: settlement.label,
        status: nurseryFinancials.status,
      },
      periodMetrics: {
        today: todayR,
        yesterday: yesterdayR,
        thisWeek: thisWeekR,
        lastWeek: lastWeekR,
        thisMonth: thisMonthR,
        lastMonth: lastMonthR,
        [currentYear]: yearThisR,
        [lastYear]: yearLastR,
        lifetime: lifetimeR,
      },
      settlementInfo: {
        currentWeekSettlement: nurseryFinancials.weeklyPayable,
        lastWeekSettlement: nurseryFinancials.pendingPayouts,
        status: "Processing",
        nextSettlementDate: settlement.iso,
        nextSettlementLabel: settlement.label,
      },
      inventory: {
        totalProducts,
        plants: pMeta.total,
        pots: potMeta.total,
        accessories: accMeta.total,
        lowStock: lowStockCount,
        outOfStock: outOfStockCount,
        healthyStock: healthyStockCount,
        items: lowStockItems,
      },
      categorySales: categoryPerformance,
      categoryPerformance,
      orderStatusDistribution: statusMap,
      statusDistribution: statusMap,
      topSellingProducts,
      lowStockItems,
      recentOrders: mappedRecentOrders,
      trends: roundedTrends,
    });
  }
);

// ======================================================================
// 🛡️ 2. ADMIN DASHBOARD CONTROLLER
// ======================================================================
export const getAdminDashboardStats = catchAsyncErrors(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { timeframe = "this_month", startDate, endDate } = req.query;
    const dateRange = getExtendedDateRangeFilter(
      timeframe as string,
      startDate as string | undefined,
      endDate as string | undefined
    );

    // 🔑 Fetch dynamic commission expression and rates ONCE for this request
    const [commExpr, dynamicRates] = await Promise.all([
      getDynamicCommissionExpression(),
      getDynamicCommissionRates(),
    ]);

    const currentYear = new Date().getFullYear().toString();
    const lastYear = (new Date().getFullYear() - 1).toString();
    const rangeMatch = { createdAt: dateRange };
    const rangeFinancialMatch = {
      createdAt: dateRange,
      orderStatus: { $ne: "Cancelled" },
      // 🛡️ SECURITY: Only SETTLED items (Delivered/Claimed) count as platform revenue.
      "orderItems.status": { $in: ["Delivered", "Claimed"] },
    };

    const [
      platformLedger,
      userSplit,
      topNurseries,
      recentPlatformOrders,
      plantCounts,
      potCounts,
      accessoryCounts,
      gardeningToolCounts,
      plantCareCounts,
      seedsBulbsCounts,
      plantStandsCounts,
      artificialDriedPlantCounts,
      lowStockPlants,
      lowStockPots,
      lowStockAccessories,
      lowStockGardeningTools,
      lowStockPlantCare,
      lowStockSeedsBulbs,
      lowStockPlantStands,
      lowStockArtificialDriedPlants,
      statusDistribution,
      categorySales,
      trendsRaw,
      topSellingRaw,
    ] = await Promise.all([
      getPlatformFinancialLedger({
        timeframe: timeframe as string,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      }),

      User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),

      Order.aggregate([
        { $unwind: "$orderItems" },
        { $match: rangeFinancialMatch },
        {
          $project: {
            nursery: "$orderItems.nursery",
            quantity: "$orderItems.quantity",
            itemTotal: {
              $multiply: [
                { $ifNull: ["$orderItems.priceAtPurchase", "$orderItems.price"] },
                "$orderItems.quantity",
              ],
            },
            commissionRate: commExpr,
            storedCommission: "$orderItems.commissionAmount",
          },
        },
        {
          $project: {
            nursery: 1,
            quantity: 1,
            itemTotal: 1,
            commission: {
              $ifNull: [
                "$storedCommission",
                { $multiply: ["$itemTotal", "$commissionRate"] },
              ],
            },
          },
        },
        {
          $group: {
            _id: "$nursery",
            totalSalesValue: { $sum: "$itemTotal" },
            itemsSold: { $sum: "$quantity" },
            commissionGenerated: { $sum: "$commission" },
          },
        },
        { $sort: { totalSalesValue: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "nurseryDetails",
          },
        },
        { $unwind: { path: "$nurseryDetails", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            nurseryId: "$_id",
            nurseryName: {
              $ifNull: ["$nurseryDetails.name", "Unknown Nursery"],
            },
            totalSalesValue: 1,
            itemsSold: 1,
            commissionGenerated: 1,
            platformCommissionGenerated: "$commissionGenerated",
            netNurseryPayout: {
              $subtract: ["$totalSalesValue", "$commissionGenerated"],
            },
          },
        },
      ]),

      Order.find()
        .populate<{ user: { name: string; email: string } | null }>("user", "name email")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),

      Product.aggregate(stockCountPipeline({ category: "plants" })),
      Product.aggregate(stockCountPipeline({ category: "pots" })),
      Product.aggregate(stockCountPipeline({ category: "accessories" })),
      Product.aggregate(stockCountPipeline({ category: "gardening-tools" })),
      Product.aggregate(stockCountPipeline({ category: "plant-care" })),
      Product.aggregate(stockCountPipeline({ category: "seeds-bulbs" })),
      Product.aggregate(stockCountPipeline({ category: { $in: ["plant-stands-shelves", "stands-shelves"] } })),
      Product.aggregate(stockCountPipeline({ category: "artificial-dried" })),

      Product.find({ category: "plants", stock: { $lt: 10 } }).select("name stock price").limit(5).lean(),
      Product.find({ category: "pots", stock: { $lt: 10 } }).select("name stock price").limit(5).lean(),
      Product.find({ category: "accessories", stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      Product.find({ category: "gardening-tools", stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      Product.find({ category: "plant-care", stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      Product.find({ category: "seeds-bulbs", stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      Product.find({ category: { $in: ["plant-stands-shelves", "stands-shelves"] }, stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      Product.find({ category: "artificial-dried", stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),

      Order.aggregate([
        { $unwind: "$orderItems" },
        { $match: rangeMatch },
        { $group: { _id: "$orderItems.status", count: { $sum: 1 } } },
      ]),

      Order.aggregate([
        { $unwind: "$orderItems" },
        { $match: rangeFinancialMatch },
        {
          $project: {
            itemModel: "$orderItems.itemModel",
            itemTotal: {
              $multiply: [
                { $ifNull: ["$orderItems.priceAtPurchase", "$orderItems.price"] },
                "$orderItems.quantity",
              ],
            },
            commissionRate: commExpr,
            storedCommission: "$orderItems.commissionAmount",
            orderId: "$_id",
          },
        },
        {
          $project: {
            itemModel: 1,
            itemTotal: 1,
            orderId: 1,
            commission: {
              $ifNull: [
                "$storedCommission",
                { $multiply: ["$itemTotal", "$commissionRate"] },
              ],
            },
          },
        },
        {
          $group: {
            _id: "$itemModel",
            revenue: { $sum: "$itemTotal" },
            commission: { $sum: "$commission" },
            netEarnings: {
              $sum: { $subtract: ["$itemTotal", "$commission"] },
            },
            orders: { $addToSet: "$orderId" },
          },
        },
        {
          $project: {
            _id: 0,
            category: "$_id",
            revenue: 1,
            commission: 1,
            netEarnings: 1,
            ordersCount: { $size: "$orders" },
          },
        },
      ]),

      Order.aggregate([
        { $unwind: "$orderItems" },
        { $match: rangeFinancialMatch },
        {
          $project: {
            createdAt: 1,
            orderId: "$_id",
            itemTotal: {
              $multiply: [
                { $ifNull: ["$orderItems.priceAtPurchase", "$orderItems.price"] },
                "$orderItems.quantity",
              ],
            },
            commissionRate: commExpr,
            storedCommission: "$orderItems.commissionAmount",
          },
        },
        {
          $project: {
            createdAt: 1,
            orderId: 1,
            itemTotal: 1,
            commission: {
              $ifNull: [
                "$storedCommission",
                { $multiply: ["$itemTotal", "$commissionRate"] },
              ],
            },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
            grossRevenue: { $sum: "$itemTotal" },
            netPayout: {
              $sum: { $subtract: ["$itemTotal", "$commission"] },
            },
            commission: { $sum: "$commission" },
            orders: { $addToSet: "$orderId" },
          },
        },
        {
          $project: {
            _id: 0,
            date: "$_id",
            grossRevenue: 1,
            netPayout: 1,
            commission: 1,
            ordersCount: { $size: "$orders" },
          },
        },
        { $sort: { date: 1 } },
      ]),

      Order.aggregate([
        { $unwind: "$orderItems" },
        { $match: rangeFinancialMatch },
        {
          $project: {
            item: "$orderItems.item",
            itemModel: "$orderItems.itemModel",
            quantity: "$orderItems.quantity",
            itemTotal: {
              $multiply: [
                { $ifNull: ["$orderItems.priceAtPurchase", "$orderItems.price"] },
                "$orderItems.quantity",
              ],
            },
            commissionRate: commExpr,
            storedCommission: "$orderItems.commissionAmount",
          },
        },
        {
          $project: {
            item: 1,
            itemModel: 1,
            quantity: 1,
            itemTotal: 1,
            commission: {
              $ifNull: [
                "$storedCommission",
                { $multiply: ["$itemTotal", "$commissionRate"] },
              ],
            },
          },
        },
        {
          $group: {
            _id: "$item",
            itemType: { $first: "$itemModel" },
            quantitySold: { $sum: "$quantity" },
            grossRevenue: { $sum: "$itemTotal" },
            commission: { $sum: "$commission" },
          },
        },
        {
          $project: {
            itemType: 1,
            quantitySold: 1,
            grossRevenue: 1,
            nurseryEarnings: { $subtract: ["$grossRevenue", "$commission"] },
          },
        },
        { $sort: { quantitySold: -1 } },
        { $limit: 10 },
      ]),
    ]);

    const selected = platformLedger.selected;

    const userMap: Record<string, number> = { user: 0, nursery: 0, admin: 0 };
    userSplit.forEach((u: { _id: string; count: number }) => {
      if (u._id in userMap) userMap[u._id] = u.count;
    });

    const pMeta = plantCounts[0] || emptyStockMeta();
    const potMeta = potCounts[0] || emptyStockMeta();
    const accMeta = accessoryCounts[0] || emptyStockMeta();
    const toolMeta = gardeningToolCounts[0] || emptyStockMeta();
    const careMeta = plantCareCounts[0] || emptyStockMeta();
    const seedsMeta = seedsBulbsCounts[0] || emptyStockMeta();
    const standsMeta = plantStandsCounts[0] || emptyStockMeta();
    const artificialDriedPlantMeta = artificialDriedPlantCounts[0] || emptyStockMeta();

    const statusMap: Record<string, number> = {
      Processing: 0,
      Packed: 0,
      Shipped: 0,
      Delivered: 0,
      Cancelled: 0,
      Returned: 0,
      Refunded: 0,
      Claimed: 0,
    };
    statusDistribution.forEach((s: { _id: string; count: number }) => {
      if (s._id in statusMap) statusMap[s._id] = s.count;
    });

    const lowStockItems = [
      ...mapLowStockRows(lowStockPlants as any, "Plant"),
      ...mapLowStockRows(lowStockPots as any, "Pot"),
      ...mapLowStockRows(lowStockAccessories as any, "Accessory"),
      ...mapLowStockRows(lowStockGardeningTools as any, "GardeningTool"),
      ...mapLowStockRows(lowStockPlantCare as any, "PlantCare"),
      ...mapLowStockRows(lowStockSeedsBulbs as any, "SeedsBulbs"),
      ...mapLowStockRows(lowStockPlantStands as any, "PlantStandsShelves"),
      ...mapLowStockRows(lowStockArtificialDriedPlants as any, "ArtificialDriedPlant")
    ];

    const topSellingProducts = await Promise.all(
      topSellingRaw.map(
        async (p: {
          _id: Types.ObjectId;
          itemType: string;
          quantitySold: number;
          grossRevenue: number;
          nurseryEarnings: number;
        }) => ({
          _id: p._id.toString(),
          name: await resolveProductName(p._id, p.itemType),
          itemType: p.itemType as "Plant" | "Pot" | "Accessory",
          quantitySold: p.quantitySold,
          grossRevenue: roundMoney(p.grossRevenue),
          nurseryEarnings: roundMoney(p.nurseryEarnings),
        })
      )
    );

    const categoryPerformance = ensureCategoryPerformance(
      categorySales.map(
        (c: {
          category: string;
          revenue: number;
          commission: number;
          netEarnings: number;
          ordersCount: number;
        }) => ({
          category: c.category,
          grossRevenue: c.revenue,
          revenue: c.revenue,
          orderCount: c.ordersCount,
          ordersCount: c.ordersCount,
          commission: c.commission,
          netEarnings: c.netEarnings,
        })
      ),
      dynamicRates
    );


    const mappedRecentOrders = await Promise.all(
      recentPlatformOrders.map(async (o) => {
        const items = await mapOrderLines(o.orderItems || []);
        const itemGross = roundMoney(
          items.reduce((sum, line) => sum + line.lineGross, 0)
        );
        const commission = roundMoney(
          items.reduce((sum, line) => sum + line.lineCommission, 0)
        );
        const gross = roundMoney(o.totalPrice ?? itemGross);
        const paymentRaw = o.paymentInfo?.status || "Pending";
        const paymentStatus =
          paymentRaw === "Succeeded" || paymentRaw === "Paid"
            ? "Paid"
            : paymentRaw === "COD" || paymentRaw === "Cash on Delivery"
              ? "Cash on Delivery"
              : paymentRaw;

        return {
          orderId: o._id.toString(),
          customerName: o.user?.name || "Guest Customer",
          items,
          itemsSummary: items.map((line) => line.label).join(", "),
          totalAmount: gross,
          adminCommission: commission,
          nurseryEarnings: roundMoney(itemGross - commission),
          orderStatus: o.orderStatus,
          paymentStatus,
          createdAt: o.createdAt,
        };
      })
    );

    const mappedTopNurseries = topNurseries.map(
      (n: {
        nurseryId?: Types.ObjectId | string;
        _id?: Types.ObjectId | string;
        nurseryName: string;
        totalSalesValue: number;
        itemsSold?: number;
        commissionGenerated: number;
        platformCommissionGenerated?: number;
        netNurseryPayout: number;
      }) => ({
        nurseryId: String(n.nurseryId ?? n._id ?? ""),
        nurseryName: n.nurseryName,
        totalSalesValue: roundMoney(n.totalSalesValue),
        itemsSold: n.itemsSold ?? 0,
        commissionGenerated: roundMoney(n.commissionGenerated),
        platformCommissionGenerated: roundMoney(
          n.platformCommissionGenerated ?? n.commissionGenerated
        ),
        netNurseryPayout: roundMoney(n.netNurseryPayout),
      })
    );

    const todayR = platformLedger.periodBreakdown.today;
    const yesterdayR = platformLedger.periodBreakdown.yesterday;
    const thisWeekR = platformLedger.periodBreakdown.thisWeek;
    const lastWeekR = platformLedger.periodBreakdown.lastWeek;
    const thisMonthR = platformLedger.periodBreakdown.thisMonth;
    const lastMonthR = platformLedger.periodBreakdown.lastMonth;
    const yearThisR = platformLedger.periodBreakdown.thisYear;
    const yearLastR = platformLedger.periodBreakdown.lastYear;
    const lifetimeR = platformLedger.periodBreakdown.lifetime;

    const settlement = {
      iso: platformLedger.nextSettlementDate,
      label: platformLedger.nextSettlementLabel,
    };
    const totalPaidOut = platformLedger.totalCompletedPayouts;
    const pendingPayouts = platformLedger.totalPendingPayouts;

    const totalProducts =
      pMeta.total +
      potMeta.total +
      accMeta.total +
      toolMeta.total +
      careMeta.total +
      seedsMeta.total +
      standsMeta.total +
      artificialDriedPlantMeta.total;
    const lowStockCount =
      pMeta.lowStock +
      potMeta.lowStock +
      accMeta.lowStock +
      toolMeta.lowStock +
      careMeta.lowStock +
      seedsMeta.lowStock +
      standsMeta.lowStock +
      artificialDriedPlantMeta.lowStock;
    const outOfStockCount =
      pMeta.outOfStock +
      potMeta.outOfStock +
      accMeta.outOfStock +
      toolMeta.outOfStock +
      careMeta.outOfStock +
      seedsMeta.outOfStock +
      standsMeta.outOfStock +
      artificialDriedPlantMeta.outOfStock;
    const healthyStockCount = Math.max(0, totalProducts - lowStockCount);

    const roundedTrends = trendsRaw.map(
      (t: {
        date: string;
        grossRevenue: number;
        netPayout: number;
        commission?: number;
        ordersCount?: number;
      }) => ({
        date: t.date,
        grossRevenue: roundMoney(t.grossRevenue),
        netPayout: roundMoney(t.netPayout),
        commission: roundMoney(t.commission ?? t.grossRevenue - t.netPayout),
        ordersCount: t.ordersCount || 0,
      })
    );

    res.status(200).json({
      success: true,
      filterApplied: timeframe,
      commissionRates: {
        Plant: dynamicRates.Plant ?? 0.30,
        Pot: dynamicRates.Pot ?? 0.25,
        Accessory: dynamicRates.Accessory ?? 0.20,
        GardeningTool: dynamicRates.GardeningTool ?? 0.20,
        PlantCare: dynamicRates.PlantCare ?? 0.20,
        SeedsBulbs: dynamicRates.SeedsBulbs ?? 0.20,
        PlantStandsShelves: dynamicRates.PlantStandsShelves ?? 0.20,
        ArtificialDriedPlant: dynamicRates.ArtificialDriedPlant ?? 0.20,
      },
      metrics: {
        grossRevenue: selected.grossGMV,
        totalGrossGMV: selected.grossGMV,
        commissionDeducted: selected.commission,
        netPlatformCommissionRevenue: selected.commission,
        netPayablePayout: selected.nurseryPayout,
        netProductSales: selected.nurseryPayout,
        totalOrders: selected.ordersCount,
        users: {
          customers: userMap.user,
          nurseries: userMap.nursery,
          admins: userMap.admin,
        },
        inventorySummary: {
          totalProducts,
          plants: pMeta.total,
          pots: potMeta.total,
          accessories: accMeta.total,
          gardeningTools: toolMeta.total,
          plantCare: careMeta.total,
          seedsBulbs: seedsMeta.total,
          plantStands: standsMeta.total,
          artificialDriedPlants: artificialDriedPlantMeta.total,
          lowStockCount,
          outOfStockCount,
          healthyStockCount,
          inStockCount: Math.max(0, totalProducts - outOfStockCount),
        },
      },
      payouts: {
        totalPaidOut,
        paidAmount: totalPaidOut,
        pendingPayouts,
        pendingPayout: pendingPayouts,
        weeklyPayable: platformLedger.weeklyPayable,
        upcomingSettlement: platformLedger.upcomingSettlement,
        nextSettlementDate: settlement.iso,
        nextSettlementLabel: settlement.label,
        status: platformLedger.status,
      },
      periodMetrics: {
        today: todayR,
        yesterday: yesterdayR,
        thisWeek: thisWeekR,
        lastWeek: lastWeekR,
        thisMonth: thisMonthR,
        lastMonth: lastMonthR,
        [currentYear]: yearThisR,
        [lastYear]: yearLastR,
        lifetime: lifetimeR,
      },
      users: {
        customers: userMap.user,
        nurseries: userMap.nursery,
        admins: userMap.admin,
      },
      topNurseries: mappedTopNurseries,
      categoryPerformance,
      statusDistribution: statusMap,
      orderStatusDistribution: statusMap,
      lowStockItems,
      topSellingProducts,
      recentPlatformOrders: mappedRecentOrders,
      recentOrders: mappedRecentOrders,
      trends: roundedTrends,
    });
  }
);
