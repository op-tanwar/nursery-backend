import CategoryCommission, { ICategoryCommission } from "../models/categoryCommissionModel";
import NurseryProfile from "../models/nurseryProfileModel";
import { Types } from "mongoose";

export interface DefaultCategoryCommissionConfig {
  category: string;
  itemModel: string;
  commissionPercentage: number;
  description: string;
}

export const DEFAULT_CATEGORY_COMMISSIONS: DefaultCategoryCommissionConfig[] = [
  {
    category: "Plants",
    itemModel: "Plant",
    commissionPercentage: 30,
    description: "Live botanical plants, indoor greenery, flowering saplings, and bonsai (30% Commission).",
  },
  {
    category: "Pots",
    itemModel: "Pot",
    commissionPercentage: 25,
    description: "Ceramic planters, terracotta pots, hanging baskets, and fiber planters (25% Commission).",
  },
  {
    category: "Accessories",
    itemModel: "Accessory",
    commissionPercentage: 20,
    description: "Watering cans, spray bottles, decorative pebbles, drip trays, and garden accents (20% Commission).",
  },
  {
    category: "Gardening Tools",
    itemModel: "GardeningTool",
    commissionPercentage: 20,
    description: "Pruning shears, shovels, hand trowels, rakes, and weeding equipment (20% Commission).",
  },
  {
    category: "Plant Care",
    itemModel: "PlantCare",
    commissionPercentage: 20,
    description: "Organic fertilizers, potting soil mixes, vermicompost, and neem oil sprays (20% Commission).",
  },
  {
    category: "Seeds & Bulbs",
    itemModel: "SeedsBulbs",
    commissionPercentage: 20,
    description: "Vegetable seeds, herb garden seed packets, and flower bulbs (20% Commission).",
  },
  {
    category: "Plant Stands",
    itemModel: "PlantStandsShelves",
    commissionPercentage: 20,
    description: "Multi-tier metal stands, wooden plant display shelves, and hanging wall racks (20% Commission).",
  },
  {
    category: "Artificial & Dried Plants",
    itemModel: "ArtificialDriedPlant",
    commissionPercentage: 20,
    description: "Preserved moss, faux succulents, synthetic foliage, and dried botanical home decor (20% Commission).",
  },
];

let cachedCommissionMap: Record<
  string,
  { category: string; itemModel: string; commissionPercentage: number }
> | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute in-memory cache

export const clearCommissionCache = (): void => {
  cachedCommissionMap = null;
  lastCacheTime = 0;
};

/**
 * Ensures default category commissions exist in the database and returns a normalized lookup map.
 * Keys in the map match both itemModel (e.g. "Plant") and category name (e.g. "Plants").
 */
export const getActiveCommissionMap = async (): Promise<
  Record<string, { category: string; itemModel: string; commissionPercentage: number }>
> => {
  const now = Date.now();
  if (cachedCommissionMap && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedCommissionMap;
  }

  let commissions = await CategoryCommission.find().lean();

  // If table is uninitialized or missing categories, seed defaults
  if (!commissions || commissions.length === 0) {
    try {
      await CategoryCommission.insertMany(DEFAULT_CATEGORY_COMMISSIONS);
      commissions = await CategoryCommission.find().lean();
    } catch (seedErr) {
      console.error(
        "[CommissionService] Auto-seed error (continuing with in-memory defaults):",
        seedErr
      );
      commissions = DEFAULT_CATEGORY_COMMISSIONS as any;
    }
  }

  const map: Record<
    string,
    { category: string; itemModel: string; commissionPercentage: number }
  > = {};

  for (const c of commissions) {
    const config = {
      category: c.category,
      itemModel: c.itemModel,
      commissionPercentage: Number(c.commissionPercentage) || 0,
    };

    // Index by model name ("Plant"), category name ("Plants"), and lowercase
    map[c.itemModel] = config;
    map[c.category] = config;
    map[c.itemModel.toLowerCase()] = config;
    map[c.category.toLowerCase()] = config;

    // Handle common plural/singular aliases
    if (c.itemModel === "Plant") {
      map["plants"] = config;
      map["Plants"] = config;
    }
    if (c.itemModel === "Pot") {
      map["pots"] = config;
      map["Pots"] = config;
    }
    if (c.itemModel === "Accessory") {
      map["accessories"] = config;
      map["Accessories"] = config;
    }
    if (c.itemModel === "GardeningTool") {
      map["gardeningtools"] = config;
      map["GardeningTools"] = config;
      map["gardening tools"] = config;
      map["Gardening Tools"] = config;
    }
    if (c.itemModel === "PlantCare") {
      map["plantcare"] = config;
      map["plant care"] = config;
      map["Plant Care"] = config;
    }
    if (c.itemModel === "SeedsBulbs") {
      map["seedsbulbs"] = config;
      map["seeds & bulbs"] = config;
      map["Seeds & Bulbs"] = config;
    }
    if (c.itemModel === "PlantStandsShelves") {
      map["plantstands"] = config;
      map["plant stands"] = config;
      map["Plant Stands"] = config;
    }
    if (c.itemModel === "ArtificialDriedPlant") {
      map["artificialdriedplant"] = config;
      map["artificial & dried plants"] = config;
      map["Artificial & Dried Plants"] = config;
    }
  }

  cachedCommissionMap = map;
  lastCacheTime = now;

  return map;
};

/**
 * Returns a clean dictionary of model/category -> decimal rate (e.g. { Plant: 0.30, Pot: 0.25 })
 * dynamically queried from the database.
 */
export const getDynamicCommissionRates = async (): Promise<Record<string, number>> => {
  const map = await getActiveCommissionMap();
  const rates: Record<string, number> = {};
  for (const [key, conf] of Object.entries(map)) {
    rates[key] = conf.commissionPercentage / 100;
  }
  return rates;
};

/**
 * Builds a dynamic MongoDB aggregation expression for calculating line-item commission rate
 * directly from live CategoryCommission records.
 */
export const getDynamicCommissionExpression = async (): Promise<any> => {
  const map = await getActiveCommissionMap();
  const branches: any[] = [];
  const processedModels = new Set<string>();

  for (const conf of Object.values(map)) {
    if (processedModels.has(conf.itemModel)) continue;
    processedModels.add(conf.itemModel);

    const rate = conf.commissionPercentage / 100;
    branches.push({
      case: {
        $or: [
          { $eq: ["$orderItems.itemModel", conf.itemModel] },
          { $eq: ["$orderItems.itemModel", conf.category] },
          { $eq: ["$orderItems.category", conf.category] },
          { $eq: ["$orderItems.category", conf.itemModel] },
          {
            $regexMatch: {
              input: { $ifNull: ["$orderItems.itemModel", ""] },
              regex: new RegExp(`^${conf.itemModel}$`, "i"),
            },
          },
          {
            $regexMatch: {
              input: { $ifNull: ["$orderItems.category", ""] },
              regex: new RegExp(`^${conf.category}$`, "i"),
            },
          },
          ...(conf.itemModel === "Plant"
            ? [
                { $ne: [{ $ifNull: ["$orderItems.plant", null] }, null] },
                {
                  $regexMatch: {
                    input: { $ifNull: ["$orderItems.itemModel", ""] },
                    regex: /^plant/i,
                  },
                },
              ]
            : []),
          ...(conf.itemModel === "Pot"
            ? [
                {
                  $regexMatch: {
                    input: { $ifNull: ["$orderItems.itemModel", ""] },
                    regex: /^pot/i,
                  },
                },
              ]
            : []),
        ],
      },
      then: rate,
    });
  }

  // Fallback branch: if not matched, use dynamic default or 0.20
  const defaultRate = map["Plant"] ? map["Plant"].commissionPercentage / 100 : 0.30;

  return {
    $switch: {
      branches,
      default: defaultRate,
    },
  };
};

export interface EffectiveCommissionResult {
  rate: number; // Decimal: 0.30 for 30%
  percentage: number; // Integer/float: 30
  source: "NURSERY_OVERRIDE" | "NURSERY_DEFAULT" | "GLOBAL_CATEGORY" | "SYSTEM_DEFAULT";
  category: string;
}

/**
 * 🎯 SINGLE SOURCE OF TRUTH: Dynamic Commission Hierarchy Engine
 *
 * Hierarchy Rule:
 * Level 1: Nursery-specific category override (commissionOverrides) OR flat default (defaultNurseryCommission)
 * Level 2: Global Category Commission rate (CategoryCommission collection)
 * Level 3: Dynamic Category fallback rate
 */
export const getEffectiveCommission = async (
  nurseryIdOrProfile?: Types.ObjectId | string | any,
  categoryOrModel?: string
): Promise<EffectiveCommissionResult> => {
  const catKey = (categoryOrModel || "").trim();
  const lowerCat = catKey.toLowerCase();

  // Level 1: Check Nursery-Specific Overrides
  let profile = nurseryIdOrProfile;
  if (
    nurseryIdOrProfile &&
    (typeof nurseryIdOrProfile === "string" || nurseryIdOrProfile instanceof Types.ObjectId)
  ) {
    profile = await NurseryProfile.findOne({
      $or: [{ nursery: nurseryIdOrProfile }, { _id: nurseryIdOrProfile }],
    })
      .select("commissionOverrides defaultNurseryCommission")
      .lean();
  }

  if (profile) {
    // 1a. Specific category override
    if (Array.isArray(profile.commissionOverrides) && profile.commissionOverrides.length > 0) {
      const match = profile.commissionOverrides.find((o: any) => {
        const oCat = String(o.category || "").toLowerCase().trim();
        return oCat === lowerCat || lowerCat.includes(oCat) || oCat.includes(lowerCat);
      });

      if (match && typeof match.customCommissionPercentage === "number") {
        const pct = Math.max(0, Math.min(100, Number(match.customCommissionPercentage)));
        return {
          rate: pct / 100,
          percentage: pct,
          source: "NURSERY_OVERRIDE",
          category: match.category,
        };
      }
    }

    // 1b. Flat nursery-wide default override
    if (
      typeof profile.defaultNurseryCommission === "number" &&
      !isNaN(profile.defaultNurseryCommission) &&
      profile.defaultNurseryCommission >= 0
    ) {
      const pct = Math.max(0, Math.min(100, Number(profile.defaultNurseryCommission)));
      return {
        rate: pct / 100,
        percentage: pct,
        source: "NURSERY_DEFAULT",
        category: catKey || "All Categories",
      };
    }
  }

  // Level 2: Global Category Commission Rate (Dynamic from CategoryCommission)
  const globalMap = await getActiveCommissionMap();

  let globalConfig = globalMap[catKey] || globalMap[lowerCat];

  if (!globalConfig) {
    // Intelligent keyword fallback
    for (const [key, conf] of Object.entries(globalMap)) {
      const lowerKey = key.toLowerCase();
      if (lowerCat && (lowerCat.includes(lowerKey) || lowerKey.includes(lowerCat))) {
        globalConfig = conf;
        break;
      }
    }
  }

  if (globalConfig && typeof globalConfig.commissionPercentage === "number") {
    const pct = Math.max(0, Math.min(100, Number(globalConfig.commissionPercentage)));
    return {
      rate: pct / 100,
      percentage: pct,
      source: "GLOBAL_CATEGORY",
      category: globalConfig.category,
    };
  }

  // Level 3: Dynamic fallback from Plants or first category
  const fallbackPct = globalMap["Plant"]?.commissionPercentage ?? 30;
  return {
    rate: fallbackPct / 100,
    percentage: fallbackPct,
    source: "SYSTEM_DEFAULT",
    category: catKey || "General",
  };
};

/**
 * Returns effective commission as decimal rate (e.g. 0.30) for financial math.
 */
export const getEffectiveCommissionRate = async (
  nurseryIdOrProfile?: Types.ObjectId | string | any,
  categoryOrModel?: string
): Promise<number> => {
  const result = await getEffectiveCommission(nurseryIdOrProfile, categoryOrModel);
  return result.rate;
};
