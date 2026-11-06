import mongoose from "mongoose";
import CategoryTax, { ICategoryTax } from "../models/categoryTaxModel";
import {
  PRODUCT_CATEGORIES,
  ProductCategorySlug,
  TaxCategoryMetadata,
  CANONICAL_TAX_CATEGORIES,
  STATUTORY_DEFAULT_TAX,
  normalizeTaxCategory,
  TAX_CATEGORY_LOOKUP,
} from "../constants/categories";

export {
  PRODUCT_CATEGORIES,
  ProductCategorySlug,
  TaxCategoryMetadata,
  CANONICAL_TAX_CATEGORIES,
  STATUTORY_DEFAULT_TAX,
  normalizeTaxCategory,
};

export interface DefaultCategoryTaxConfig {
  category: string;
  itemModel: string;
  taxPercentage: number;
  isTaxInclusive: boolean;
  description: string;
}

export const DEFAULT_CATEGORY_TAXES: DefaultCategoryTaxConfig[] = [
  {
    category: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANTS].category,
    itemModel: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANTS].itemModel,
    taxPercentage: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANTS].taxPercentage,
    isTaxInclusive: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANTS].isTaxInclusive,
    description: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANTS].description,
  },
  {
    category: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS].category,
    itemModel: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS].itemModel,
    taxPercentage: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS].taxPercentage,
    isTaxInclusive: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS].isTaxInclusive,
    description: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS].description,
  },
  {
    category: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ACCESSORIES].category,
    itemModel: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ACCESSORIES].itemModel,
    taxPercentage: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ACCESSORIES].taxPercentage,
    isTaxInclusive: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ACCESSORIES].isTaxInclusive,
    description: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ACCESSORIES].description,
  },
  {
    category: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS].category,
    itemModel: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS].itemModel,
    taxPercentage: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS].taxPercentage,
    isTaxInclusive: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS].isTaxInclusive,
    description: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS].description,
  },
  {
    category: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANT_CARE].category,
    itemModel: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANT_CARE].itemModel,
    taxPercentage: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANT_CARE].taxPercentage,
    isTaxInclusive: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANT_CARE].isTaxInclusive,
    description: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANT_CARE].description,
  },
  {
    category: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS].category,
    itemModel: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS].itemModel,
    taxPercentage: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS].taxPercentage,
    isTaxInclusive: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS].isTaxInclusive,
    description: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS].description,
  },
  {
    category: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES].category,
    itemModel: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES].itemModel,
    taxPercentage: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES].taxPercentage,
    isTaxInclusive: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES].isTaxInclusive,
    description: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES].description,
  },
  {
    category: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED].category,
    itemModel: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED].itemModel,
    taxPercentage: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED].taxPercentage,
    isTaxInclusive: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED].isTaxInclusive,
    description: CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED].description,
  },
];

export interface ActiveTaxConfig {
  category: string;
  itemModel: string;
  slug?: string;
  taxPercentage: number;
  isTaxInclusive: boolean;
}

let cachedTaxMap: Record<string, ActiveTaxConfig> | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute in-memory cache

export const clearTaxCache = () => {
  cachedTaxMap = null;
  lastCacheTime = 0;
};

/**
 * Ensures default category taxes exist in the database and returns a normalized lookup map.
 * Keys in the map match:
 *   1. Mongoose model name ("GardeningTool", "Plant", etc.)
 *   2. Title Case category name ("Gardening Tools", "Plants", etc.)
 *   3. Hyphenated canonical slug ("gardening-tools", "plants", etc.)
 *   4. Lowercase variants of all the above.
 */
export const getActiveTaxMap = async (): Promise<Record<string, ActiveTaxConfig>> => {
  const now = Date.now();
  if (cachedTaxMap && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedTaxMap;
  }

  let taxes: any[] = [];
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      taxes = await CategoryTax.find().lean();
      // If table is uninitialized, auto-seed defaults
      if (!taxes || taxes.length === 0) {
        await CategoryTax.insertMany(DEFAULT_CATEGORY_TAXES);
        taxes = await CategoryTax.find().lean();
      }
    } catch (findErr) {
      console.error("[TaxService] Failed to query CategoryTax, falling back to canonical defaults:", findErr);
      taxes = DEFAULT_CATEGORY_TAXES as any;
    }
  } else {
    taxes = DEFAULT_CATEGORY_TAXES as any;
  }

  const map: Record<string, ActiveTaxConfig> = {};

  for (const t of taxes) {
    const meta = normalizeTaxCategory(t.category || t.itemModel);
    const config: ActiveTaxConfig = {
      category: t.category,
      itemModel: t.itemModel,
      slug: meta.isRecognized ? meta.slug : undefined,
      taxPercentage: Number(t.taxPercentage) || 0,
      isTaxInclusive: Boolean(t.isTaxInclusive),
    };

    // 1. Index by DB category name ("Gardening Tools") and lowercase
    if (t.category) {
      map[t.category] = config;
      map[t.category.toLowerCase()] = config;
    }

    // 2. Index by DB itemModel ("GardeningTool") and lowercase
    if (t.itemModel) {
      map[t.itemModel] = config;
      map[t.itemModel.toLowerCase()] = config;
    }

    // 3. Index by canonical slug ("gardening-tools")
    if (meta.isRecognized && meta.slug) {
      map[meta.slug] = config;
      map[meta.slug.toLowerCase()] = config;
    }
  }

  // Ensure all 8 canonical category slugs have a guaranteed entry in the map
  for (const [slug, canonicalMeta] of Object.entries(CANONICAL_TAX_CATEGORIES)) {
    if (!map[slug]) {
      const fallbackConfig: ActiveTaxConfig = {
        category: canonicalMeta.category,
        itemModel: canonicalMeta.itemModel,
        slug: canonicalMeta.slug,
        taxPercentage: canonicalMeta.taxPercentage,
        isTaxInclusive: canonicalMeta.isTaxInclusive,
      };
      map[slug] = fallbackConfig;
      map[canonicalMeta.category] = fallbackConfig;
      map[canonicalMeta.itemModel] = fallbackConfig;
      map[slug.toLowerCase()] = fallbackConfig;
      map[canonicalMeta.category.toLowerCase()] = fallbackConfig;
      map[canonicalMeta.itemModel.toLowerCase()] = fallbackConfig;
    }
  }

  cachedTaxMap = map;
  lastCacheTime = now;

  return map;
};

/**
 * 🎯 Authoritative Single-Item Tax Resolver.
 * Given an item's category, modelName, or raw identifier, resolves the exact tax configuration
 * against the dynamic database taxMap or canonical SSOT defaults without substring loops.
 */
export const resolveItemTaxConfig = (
  identifier?: string | null,
  taxMap?: Record<string, ActiveTaxConfig>,
  productId?: string | null
): ActiveTaxConfig => {
  const normalized = normalizeTaxCategory(identifier, productId);

  if (taxMap) {
    const directMatch =
      taxMap[normalized.slug] ||
      taxMap[normalized.category] ||
      taxMap[normalized.itemModel] ||
      (identifier ? taxMap[identifier] || taxMap[identifier.toLowerCase()] : undefined);

    if (directMatch) {
      return {
        category: directMatch.category || normalized.category,
        itemModel: directMatch.itemModel || normalized.itemModel,
        slug: directMatch.slug || normalized.slug,
        taxPercentage: Number(directMatch.taxPercentage) || 0,
        isTaxInclusive: Boolean(directMatch.isTaxInclusive),
      };
    }
  }

  return {
    category: normalized.category,
    itemModel: normalized.itemModel,
    slug: normalized.slug,
    taxPercentage: normalized.taxPercentage,
    isTaxInclusive: normalized.isTaxInclusive,
  };
};
