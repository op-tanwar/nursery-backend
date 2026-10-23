import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import Order from "../models/orderModel";
import Plant from "../models/plantsModel";
import Pot from "../models/potsModel";
import Accessory from "../models/accessoriesModel";
import GardeningTool from "../models/gardeningToolsModel";
import PlantCare from "../models/plantCareModel";
import SeedsBulbs from "../models/seedsBulbsModel";
import PlantStandsShelves from "../models/plantStandsShelvesModel";
import ArtificialDriedPlant from "../models/artificialDriedPlantModel";
import User from "../models/userModel";
import Payout from "../models/payoutModel";
import { getCaseInsensitiveModel } from "../utils/productRegistry";
import {
  roundMoney as roundMoney_,
  getNextSettlementDate,
  getDynamicCommissionExpression,
  getDynamicCommissionRates,
  getActiveCommissionMap,
  calculateNurseryFinancialSummary,
  calculateGlobalFinancialSummary,
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



// Use centralized paise-safe rounding from financialUtils
const roundMoney = roundMoney_;
const getCommissionRate = async (itemModel: string): Promise<number> => {
  const map = await getActiveCommissionMap();
  const entry = map[itemModel] || map[itemModel?.toLowerCase?.()];
  return entry ? entry.commissionPercentage / 100 : 0.30;
};

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
  }>
): Promise<IMappedOrderLine[]> =>
  Promise.all(
    items.map(async (item) => {
      const name = await resolveProductName(item.item, item.itemModel);
      const lineGross = roundMoney(item.price * item.quantity);
      const rate = await getCommissionRate(item.itemModel);
      const lineCommission = roundMoney(lineGross * rate);
      const category = (CATEGORY_LIST.includes(
        item.itemModel as (typeof CATEGORY_LIST)[number]
      )
        ? item.itemModel
        : "Accessory") as (typeof CATEGORY_LIST)[number];

      return {
        name,
        quantity: item.quantity,
        category,
        unitPrice: roundMoney(item.price),
        lineGross,
        lineCommission,
        lineNet: roundMoney(lineGross - lineCommission),
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


const getExtendedDateRangeFilter = (
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
      end = new Date(now.getFullYear() + 10, 11, 31);
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

const getMultiPeriodAggregationPipeline = (
  matchFilter: Record<string, unknown>,
  commExpr: unknown
) => [
  { $unwind: "$orderItems" },
  { $match: matchFilter },
  {
    $project: {
      createdAt: 1,
      itemTotal: { $multiply: ["$orderItems.price", "$orderItems.quantity"] },
      commissionRate: commExpr,
      orderId: "$_id",
    },
  },
  {
    $project: {
      createdAt: 1,
      itemTotal: 1,
      orderId: 1,
      commissionAmount: { $multiply: ["$itemTotal", "$commissionRate"] },
      nurseryEarning: {
        $subtract: ["$itemTotal", { $multiply: ["$itemTotal", "$commissionRate"] }],
      },
    },
  },
  {
    $group: {
      _id: null,
      grossRevenue: { $sum: "$itemTotal" },
      commission: { $sum: "$commissionAmount" },
      nurseryEarnings: { $sum: "$nurseryEarning" },
      ordersCount: { $addToSet: "$orderId" },
    },
  },
  {
    $project: {
      _id: 0,
      grossRevenue: 1,
      commission: 1,
      nurseryEarnings: 1,
      ordersCount: { $size: "$ordersCount" },
    },
  },
];

const getPeriodStats = async (
  tf: string,
  nurseryId?: Types.ObjectId
): Promise<IPeriodMetrics> => {
  const range = getExtendedDateRangeFilter(tf);
  const commExpr = await getDynamicCommissionExpression();
  const matchFilter: Record<string, unknown> = {
    createdAt: range,
    // 🛡️ SECURITY: Mirror financialUtils.ts — only SETTLED items (Delivered/Claimed) count as revenue.
    // Processing & Shipped are excluded — vendor has NOT earned them yet.
    "orderItems.status": { $in: ["Delivered", "Claimed"] },
  };
  if (nurseryId) {
    matchFilter["orderItems.nursery"] = nurseryId;
  }
  const result = await Order.aggregate(getMultiPeriodAggregationPipeline(matchFilter, commExpr));
  return roundPeriodMetrics((result[0] as IPeriodMetrics) || emptyPeriodMetrics());
};

const getGlobalPeriodStats = async (tf: string): Promise<IGlobalPeriodMetrics> => {
  const range = getExtendedDateRangeFilter(tf);
  const commExpr = await getDynamicCommissionExpression();
  const result = await Order.aggregate([
    { $unwind: "$orderItems" },
    {
      $match: {
        createdAt: range,
        // 🛡️ SECURITY: Only settled items count toward platform GMV and commission.
        "orderItems.status": { $in: ["Delivered", "Claimed"] },
      },
    },
    {
      $project: {
        itemTotal: { $multiply: ["$orderItems.price", "$orderItems.quantity"] },
        commissionRate: commExpr,
        orderId: "$_id",
      },
    },
    {
      $group: {
        _id: null,
        grossGMV: { $sum: "$itemTotal" },
        commission: { $sum: { $multiply: ["$itemTotal", "$commissionRate"] } },
        ordersCount: { $addToSet: "$orderId" },
      },
    },
    {
      $project: {
        _id: 0,
        grossGMV: 1,
        commission: 1,
        nurseryPayout: { $subtract: ["$grossGMV", "$commission"] },
        ordersCount: { $size: "$ordersCount" },
      },
    },
  ]);
  return roundGlobalPeriodMetrics(
    (result[0] as IGlobalPeriodMetrics) || emptyGlobalPeriodMetrics()
  );
};


const resolveProductName = async (
  itemId: Types.ObjectId | string,
  itemModel: string
): Promise<string> => {
  const cacheKey = `pname:${itemModel}:${String(itemId)}`;
  const cached = cacheManager.get<string>(cacheKey);
  if (cached) return cached;

  const TargetModel = getCaseInsensitiveModel(itemModel);
  if (!TargetModel) return "Unknown Product";
  const doc = await TargetModel.findById(itemId).select("name").lean();
  const name = (doc as any)?.name || "Unknown Product";
  cacheManager.set(cacheKey, name, 600); // 10 min TTL
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

    const nurseryId = new Types.ObjectId(userId.toString());
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
      "orderItems.nursery": nurseryId,
      createdAt: dateRange,
    };
    const nurseryFinancialMatch = {
      "orderItems.nursery": nurseryId,
      createdAt: dateRange,
      // 🛡️ SECURITY: Only SETTLED items (Delivered/Claimed) contribute to earnings.

      // Consistent with financialUtils.ts authoritative calculation.
      "orderItems.status": { $in: ["Delivered", "Claimed"] },
    };

    const [
      today,
      yesterday,
      thisWeek,
      lastWeek,
      thisMonth,
      lastMonth,
      yearThis,
      yearLast,
      lifetime,
      selectedPeriod,
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
      getPeriodStats("today", nurseryId),
      getPeriodStats("yesterday", nurseryId),
      getPeriodStats("this_week", nurseryId),
      getPeriodStats("last_week", nurseryId),
      getPeriodStats("this_month", nurseryId),
      getPeriodStats("last_month", nurseryId),
      getPeriodStats("this_year", nurseryId),
      getPeriodStats("last_year", nurseryId),
      getPeriodStats("lifetime", nurseryId),

      Order.aggregate(getMultiPeriodAggregationPipeline(nurseryFinancialMatch, commExpr)),

      Order.aggregate([
        { $unwind: "$orderItems" },
        { $match: nurseryFinancialMatch },
        {
          $project: {
            itemModel: "$orderItems.itemModel",
            itemTotal: { $multiply: ["$orderItems.price", "$orderItems.quantity"] },
            commissionRate: commExpr,
            orderId: "$_id",
          },
        },
        {
          $group: {
            _id: "$itemModel",
            revenue: { $sum: "$itemTotal" },
            commission: { $sum: { $multiply: ["$itemTotal", "$commissionRate"] } },
            netEarnings: {
              $sum: {
                $subtract: [
                  "$itemTotal",
                  { $multiply: ["$itemTotal", "$commissionRate"] },
                ],
              },
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

      Plant.aggregate(stockCountPipeline({ nursery: nurseryId })),
      Pot.aggregate(stockCountPipeline({ nursery: nurseryId })),
      Accessory.aggregate(stockCountPipeline({ nursery: nurseryId })),
      GardeningTool.aggregate(stockCountPipeline({ nursery: nurseryId })),
      PlantCare.aggregate(stockCountPipeline({ nursery: nurseryId })),
      SeedsBulbs.aggregate(stockCountPipeline({ nursery: nurseryId })),
      PlantStandsShelves.aggregate(stockCountPipeline({ nursery: nurseryId })),
      ArtificialDriedPlant.aggregate(stockCountPipeline({ nursery: nurseryId })),

      Plant.find({ nursery: nurseryId, stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      Pot.find({ nursery: nurseryId, stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      Accessory.find({ nursery: nurseryId, stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      GardeningTool.find({ nursery: nurseryId, stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      PlantCare.find({ nursery: nurseryId, stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      SeedsBulbs.find({ nursery: nurseryId, stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      PlantStandsShelves.find({ nursery: nurseryId, stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      ArtificialDriedPlant.find({ nursery: nurseryId, stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),

      Order.find({ "orderItems.nursery": nurseryId })
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
            itemTotal: { $multiply: ["$orderItems.price", "$orderItems.quantity"] },
            commissionRate: commExpr,
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
            grossRevenue: { $sum: "$itemTotal" },
            netPayout: {
              $sum: {
                $subtract: [
                  "$itemTotal",
                  { $multiply: ["$itemTotal", "$commissionRate"] },
                ],
              },
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

    const selected = roundPeriodMetrics(
      (selectedPeriod[0] as IPeriodMetrics) || emptyPeriodMetrics()
    );
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

    const mappedRecentOrders = await Promise.all(
      recentOrders.map(async (o) => {
        const nurseryItems = (o.orderItems || []).filter(
          (item) => item.nursery?.toString() === nurseryId.toString()
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

    const todayR = roundPeriodMetrics(today);
    const yesterdayR = roundPeriodMetrics(yesterday);
    const thisWeekR = roundPeriodMetrics(thisWeek);
    const lastWeekR = roundPeriodMetrics(lastWeek);
    const thisMonthR = roundPeriodMetrics(thisMonth);
    const lastMonthR = roundPeriodMetrics(lastMonth);
    const yearThisR = roundPeriodMetrics(yearThis);
    const yearLastR = roundPeriodMetrics(yearLast);
    const lifetimeR = roundPeriodMetrics(lifetime);

    const settlement = formatSettlementDate();
    // 🛡️ AUTHORITATIVE FINANCIAL SUMMARY (Single source of truth via financialUtils)
    const nurseryFinancials = await calculateNurseryFinancialSummary(nurseryId);
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
        // Real DB data from Payout model
        availableBalance,
        totalPaidOut,
        paidAmount: totalPaidOut,
        pendingPayouts,
        // 🔧 FIX: Use actual pending payout amount only — never fall back to period earnings.
        pendingPayout: pendingPayouts,
        hasNegativeBalance,
        // Period-based breakdowns (for dashboard stat cards)
        weeklyPayable: thisWeekR.nurseryEarnings,
        grossLifetimeEarnings: nurseryFinancials.grossEarnings,
        netLifetimeEarnings: nurseryFinancials.netSales,
        totalCommissionLifetime: nurseryFinancials.totalCommission,
        upcomingSettlement: thisWeekR.nurseryEarnings,
        nextSettlementDate: settlement.iso,
        nextSettlementLabel: settlement.label,
        status: hasNegativeBalance ? "NegativeBalance" : pendingPayouts > 0 ? "Processing" : "Available",
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
        currentWeekSettlement: thisWeekR.nurseryEarnings,
        lastWeekSettlement: lastWeekR.nurseryEarnings,
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
      // 🛡️ SECURITY: Only SETTLED items (Delivered/Claimed) count as platform revenue.
      // Consistent with financialUtils.ts — excludes Processing, Shipped, and Cancelled.
      "orderItems.status": { $in: ["Delivered", "Claimed"] },
    };


    const [
      today,
      yesterday,
      thisWeek,
      lastWeek,
      thisMonth,
      lastMonth,
      yearThis,
      yearLast,
      lifetime,
      selectedPeriod,
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
      getGlobalPeriodStats("today"),
      getGlobalPeriodStats("yesterday"),
      getGlobalPeriodStats("this_week"),
      getGlobalPeriodStats("last_week"),
      getGlobalPeriodStats("this_month"),
      getGlobalPeriodStats("last_month"),
      getGlobalPeriodStats("this_year"),
      getGlobalPeriodStats("last_year"),
      getGlobalPeriodStats("lifetime"),

      Order.aggregate([
        { $unwind: "$orderItems" },
        { $match: rangeFinancialMatch },
        {
          $project: {
            itemTotal: { $multiply: ["$orderItems.price", "$orderItems.quantity"] },
            commissionRate: commExpr,
            orderId: "$_id",
          },
        },
        {
          $group: {
            _id: null,
            grossGMV: { $sum: "$itemTotal" },
            commission: { $sum: { $multiply: ["$itemTotal", "$commissionRate"] } },
            ordersCount: { $addToSet: "$orderId" },
          },
        },
        {
          $project: {
            _id: 0,
            grossGMV: 1,
            commission: 1,
            nurseryPayout: { $subtract: ["$grossGMV", "$commission"] },
            ordersCount: { $size: "$ordersCount" },
          },
        },
      ]),

      User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),

      Order.aggregate([
        { $unwind: "$orderItems" },
        { $match: rangeFinancialMatch },
        {
          $project: {
            nursery: "$orderItems.nursery",
            quantity: "$orderItems.quantity",
            itemTotal: { $multiply: ["$orderItems.price", "$orderItems.quantity"] },
            commissionRate: commExpr,
          },
        },
        {
          $group: {
            _id: "$nursery",
            totalSalesValue: { $sum: "$itemTotal" },
            itemsSold: { $sum: "$quantity" },
            commissionGenerated: {
              $sum: { $multiply: ["$itemTotal", "$commissionRate"] },
            },
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

      Plant.aggregate(stockCountPipeline({})),
      Pot.aggregate(stockCountPipeline({})),
      Accessory.aggregate(stockCountPipeline({})),
      GardeningTool.aggregate(stockCountPipeline({})),
      PlantCare.aggregate(stockCountPipeline({})),
      SeedsBulbs.aggregate(stockCountPipeline({})),
      PlantStandsShelves.aggregate(stockCountPipeline({})),
      ArtificialDriedPlant.aggregate(stockCountPipeline({})),

      Plant.find({ stock: { $lt: 10 } }).select("name stock price").limit(5).lean(),
      Pot.find({ stock: { $lt: 10 } }).select("name stock price").limit(5).lean(),
      Accessory.find({ stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      GardeningTool.find({ stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      PlantCare.find({ stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      SeedsBulbs.find({ stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      PlantStandsShelves.find({ stock: { $lt: 10 } })
        .select("name stock price")
        .limit(5)
        .lean(),
      ArtificialDriedPlant.find({ stock: { $lt: 10 } })
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
            itemTotal: { $multiply: ["$orderItems.price", "$orderItems.quantity"] },
            commissionRate: commExpr,
            orderId: "$_id",
          },
        },
        {
          $group: {
            _id: "$itemModel",
            revenue: { $sum: "$itemTotal" },
            commission: { $sum: { $multiply: ["$itemTotal", "$commissionRate"] } },
            netEarnings: {
              $sum: {
                $subtract: [
                  "$itemTotal",
                  { $multiply: ["$itemTotal", "$commissionRate"] },
                ],
              },
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
            itemTotal: { $multiply: ["$orderItems.price", "$orderItems.quantity"] },
            commissionRate: commExpr,
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
            grossRevenue: { $sum: "$itemTotal" },
            netPayout: {
              $sum: {
                $subtract: [
                  "$itemTotal",
                  { $multiply: ["$itemTotal", "$commissionRate"] },
                ],
              },
            },
            commission: {
              $sum: { $multiply: ["$itemTotal", "$commissionRate"] },
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
    ]);

    const selected = roundGlobalPeriodMetrics(
      (selectedPeriod[0] as IGlobalPeriodMetrics) || emptyGlobalPeriodMetrics()
    );

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

    const todayR = roundGlobalPeriodMetrics(today);
    const yesterdayR = roundGlobalPeriodMetrics(yesterday);
    const thisWeekR = roundGlobalPeriodMetrics(thisWeek);
    const lastWeekR = roundGlobalPeriodMetrics(lastWeek);
    const thisMonthR = roundGlobalPeriodMetrics(thisMonth);
    const lastMonthR = roundGlobalPeriodMetrics(lastMonth);
    const yearThisR = roundGlobalPeriodMetrics(yearThis);
    const yearLastR = roundGlobalPeriodMetrics(yearLast);
    const lifetimeR = roundGlobalPeriodMetrics(lifetime);

    const settlement = formatSettlementDate();
    const lifetimeSettled = roundMoney(
      Math.max(
        0,
        lifetimeR.nurseryPayout - thisWeekR.nurseryPayout - lastWeekR.nurseryPayout
      )
    );

    // 🛡️ AUTHORITATIVE GLOBAL FINANCIAL SUMMARY (Single source of truth via financialUtils)
    const globalFinancials = await calculateGlobalFinancialSummary();
    const totalPaidOut = globalFinancials.totalCompletedPayouts;
    const pendingPayouts = globalFinancials.totalPendingPayouts;

    // Harmonize lifetime metrics with authoritative calculation
    lifetimeR.grossGMV = globalFinancials.grossGMV;
    lifetimeR.commission = globalFinancials.platformCommission;
    lifetimeR.nurseryPayout = globalFinancials.nurseryPayoutPayable;
    lifetimeR.ordersCount = globalFinancials.totalOrdersCount;

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
        // 🔧 FIX: Always use actual completed payout amount. Never fall back to estimated earnings.
        paidAmount: totalPaidOut,
        pendingPayouts,
        // 🔧 FIX: Return actual pending amount only — never fall back to period earnings.
        pendingPayout: pendingPayouts,
        weeklyPayable: thisWeekR.nurseryPayout,
        upcomingSettlement: thisWeekR.commission,
        nextSettlementDate: settlement.iso,
        nextSettlementLabel: settlement.label,
        status: pendingPayouts > 0 ? "Processing" : "Available",
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
