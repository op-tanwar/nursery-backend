import CategoryTax, { ICategoryTax } from "../models/categoryTaxModel";

export interface DefaultCategoryTaxConfig {
  category: string;
  itemModel: string;
  taxPercentage: number;
  isTaxInclusive: boolean;
  description: string;
}

export const DEFAULT_CATEGORY_TAXES: DefaultCategoryTaxConfig[] = [
  {
    category: "Plants",
    itemModel: "Plant",
    taxPercentage: 5,
    isTaxInclusive: false,
    description: "Live plants, saplings, and indoor/outdoor botanical greenery (5% GST).",
  },
  {
    category: "Pots",
    itemModel: "Pot",
    taxPercentage: 12,
    isTaxInclusive: false,
    description: "Ceramic, terracotta, fiber, and plastic planters (12% GST).",
  },
  {
    category: "Accessories",
    itemModel: "Accessory",
    taxPercentage: 18,
    isTaxInclusive: false,
    description: "Watering cans, decorative pebbles, drip trays, and garden decor (18% GST).",
  },
  {
    category: "Gardening Tools",
    itemModel: "GardeningTool",
    taxPercentage: 18,
    isTaxInclusive: false,
    description: "Pruners, shears, trowels, shovels, and metal gardening equipment (18% GST).",
  },
  {
    category: "Plant Care",
    itemModel: "PlantCare",
    taxPercentage: 12,
    isTaxInclusive: false,
    description: "Bio-fertilizers, neem oil sprays, potting soil mixes, and organic nutrients (12% GST).",
  },
  {
    category: "Seeds & Bulbs",
    itemModel: "SeedsBulbs",
    taxPercentage: 0,
    isTaxInclusive: false,
    description: "Agricultural seeds, flower bulbs, and kitchen garden planting seed packs (0% GST - Exempt).",
  },
  {
    category: "Plant Stands",
    itemModel: "PlantStandsShelves",
    taxPercentage: 18,
    isTaxInclusive: false,
    description: "Iron/metal stands, wooden multi-tier shelves, and corner planters (18% GST).",
  },
  {
    category: "Artificial & Dried Plants",
    itemModel: "ArtificialDriedPlant",
    taxPercentage: 18,
    isTaxInclusive: false,
    description: "Synthetic flora, preserved stems, dried moss, and botanical home accents (18% GST).",
  },
];

let cachedTaxMap: Record<string, { category: string; taxPercentage: number; isTaxInclusive: boolean }> | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute in-memory cache

export const clearTaxCache = () => {
  cachedTaxMap = null;
  lastCacheTime = 0;
};

/**
 * Ensures default category taxes exist in the database and returns a normalized lookup map.
 * Keys in the map match both itemModel (e.g. "Plant") and category name (e.g. "Plants").
 */
export const getActiveTaxMap = async (): Promise<
  Record<string, { category: string; itemModel: string; taxPercentage: number; isTaxInclusive: boolean }>
> => {
  const now = Date.now();
  if (cachedTaxMap && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedTaxMap as any;
  }

  let taxes = await CategoryTax.find().lean();

  // If table is uninitialized, auto-seed defaults
  if (!taxes || taxes.length === 0) {
    try {
      await CategoryTax.insertMany(DEFAULT_CATEGORY_TAXES);
      taxes = await CategoryTax.find().lean();
    } catch (seedErr) {
      console.error("[TaxService] Auto-seed error (continuing with in-memory defaults):", seedErr);
      taxes = DEFAULT_CATEGORY_TAXES as any;
    }
  }

  const map: Record<string, { category: string; itemModel: string; taxPercentage: number; isTaxInclusive: boolean }> = {};

  for (const t of taxes) {
    const config = {
      category: t.category,
      itemModel: t.itemModel,
      taxPercentage: Number(t.taxPercentage) || 0,
      isTaxInclusive: Boolean(t.isTaxInclusive),
    };

    // Index by both model name ("Plant") and category name ("Plants")
    map[t.itemModel] = config;
    map[t.category] = config;
    map[t.itemModel.toLowerCase()] = config;
    map[t.category.toLowerCase()] = config;
  }

  cachedTaxMap = map as any;
  lastCacheTime = now;

  return map;
};
