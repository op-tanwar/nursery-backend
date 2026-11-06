/**
 * ======================================================================
 * 🏷️ PRODUCT CATEGORIES & TAX ENGINE REGISTRY (SSOT)
 * ======================================================================
 * Single Source of Truth for product category slugs, Mongoose itemModel
 * discriminators, display titles, and authoritative GST tax slabs.
 *
 * Consumed symmetrically by both backend and frontend to eliminate tax
 * discrepancies, checkout mismatches, and payment webhook failures.
 * ======================================================================
 */

// 1. CANONICAL CATEGORY SLUGS
export const PRODUCT_CATEGORIES = {
  PLANTS: "plants",
  POTS: "pots",
  POTS_PLANTERS: "pots-planters",
  ACCESSORIES: "accessories",
  GARDENING_TOOLS: "gardening-tools",
  PLANT_CARE: "plant-care",
  SEEDS_BULBS: "seeds-bulbs",
  STANDS_SHELVES: "plant-stands-shelves", // Canonical slug
  LEGACY_STANDS_SHELVES: "stands-shelves", // Backward compatibility alias
  ARTIFICIAL_DRIED: "artificial-dried",
} as const;

export type ProductCategory =
  (typeof PRODUCT_CATEGORIES)[keyof typeof PRODUCT_CATEGORIES];
export type ProductCategorySlug = ProductCategory;

export const ALL_PRODUCT_CATEGORY_SLUGS: readonly ProductCategorySlug[] = Object.values(
  PRODUCT_CATEGORIES
);

// 2. TAX CATEGORY METADATA INTERFACE
export interface TaxCategoryMetadata {
  slug: ProductCategorySlug | "general";
  category: string; // Title Case display name e.g. "Gardening Tools"
  itemModel: string; // PascalCase Mongoose model name e.g. "GardeningTool"
  taxPercentage: number;
  isTaxInclusive: boolean;
  description: string;
  isRecognized: boolean;
}

// 3. STATUTORY DEFAULT TAX (Fallback for truly unknown items)
export const STATUTORY_DEFAULT_TAX: TaxCategoryMetadata = {
  slug: "general",
  category: "General",
  itemModel: "Product",
  taxPercentage: 18,
  isTaxInclusive: false,
  description: "Standard statutory GST rate (18% exclusive) for unclassified goods.",
  isRecognized: false,
};

// 4. CANONICAL TAX SLABS DEFINITION (8 Product Groups)
export const CANONICAL_TAX_CATEGORIES: Record<string, TaxCategoryMetadata> = {
  [PRODUCT_CATEGORIES.PLANTS]: {
    slug: PRODUCT_CATEGORIES.PLANTS,
    category: "Plants",
    itemModel: "Plant",
    taxPercentage: 5,
    isTaxInclusive: false,
    description: "Live plants, saplings, and indoor/outdoor botanical greenery (5% GST).",
    isRecognized: true,
  },
  [PRODUCT_CATEGORIES.POTS]: {
    slug: PRODUCT_CATEGORIES.POTS,
    category: "Pots",
    itemModel: "Pot",
    taxPercentage: 18,
    isTaxInclusive: false,
    description: "Ceramic, terracotta, fiber, and plastic planters (18% GST).",
    isRecognized: true,
  },
  [PRODUCT_CATEGORIES.POTS_PLANTERS]: {
    slug: PRODUCT_CATEGORIES.POTS_PLANTERS,
    category: "Pots",
    itemModel: "Pot",
    taxPercentage: 18,
    isTaxInclusive: false,
    description: "Ceramic, terracotta, fiber, and plastic planters (18% GST).",
    isRecognized: true,
  },
  [PRODUCT_CATEGORIES.ACCESSORIES]: {
    slug: PRODUCT_CATEGORIES.ACCESSORIES,
    category: "Accessories",
    itemModel: "Accessory",
    taxPercentage: 18,
    isTaxInclusive: false,
    description: "Watering cans, decorative pebbles, drip trays, and garden decor (18% GST).",
    isRecognized: true,
  },
  [PRODUCT_CATEGORIES.GARDENING_TOOLS]: {
    slug: PRODUCT_CATEGORIES.GARDENING_TOOLS,
    category: "Gardening Tools",
    itemModel: "GardeningTool",
    taxPercentage: 18,
    isTaxInclusive: false,
    description: "Pruners, shears, trowels, shovels, and metal gardening equipment (18% GST).",
    isRecognized: true,
  },
  [PRODUCT_CATEGORIES.PLANT_CARE]: {
    slug: PRODUCT_CATEGORIES.PLANT_CARE,
    category: "Plant Care",
    itemModel: "PlantCare",
    taxPercentage: 18,
    isTaxInclusive: false,
    description: "Bio-fertilizers, neem oil sprays, potting soil mixes, and organic nutrients (18% GST).",
    isRecognized: true,
  },
  [PRODUCT_CATEGORIES.SEEDS_BULBS]: {
    slug: PRODUCT_CATEGORIES.SEEDS_BULBS,
    category: "Seeds & Bulbs",
    itemModel: "SeedsBulbs",
    taxPercentage: 0,
    isTaxInclusive: false,
    description: "Agricultural seeds, flower bulbs, and kitchen garden planting seed packs (0% GST - Exempt).",
    isRecognized: true,
  },
  [PRODUCT_CATEGORIES.STANDS_SHELVES]: {
    slug: PRODUCT_CATEGORIES.STANDS_SHELVES,
    category: "Plant Stands",
    itemModel: "PlantStandsShelves",
    taxPercentage: 18,
    isTaxInclusive: false,
    description: "Iron/metal stands, wooden multi-tier shelves, and corner planters (18% GST).",
    isRecognized: true,
  },
  "stands-shelves": {
    slug: PRODUCT_CATEGORIES.STANDS_SHELVES,
    category: "Plant Stands",
    itemModel: "PlantStandsShelves",
    taxPercentage: 18,
    isTaxInclusive: false,
    description: "Iron/metal stands, wooden multi-tier shelves, and corner planters (18% GST).",
    isRecognized: true,
  },
  "plant-stands-and-shelves": {
    slug: PRODUCT_CATEGORIES.STANDS_SHELVES,
    category: "Plant Stands",
    itemModel: "PlantStandsShelves",
    taxPercentage: 18,
    isTaxInclusive: false,
    description: "Iron/metal stands, wooden multi-tier shelves, and corner planters (18% GST).",
    isRecognized: true,
  },
  [PRODUCT_CATEGORIES.ARTIFICIAL_DRIED]: {
    slug: PRODUCT_CATEGORIES.ARTIFICIAL_DRIED,
    category: "Artificial & Dried Plants",
    itemModel: "ArtificialDriedPlant",
    taxPercentage: 18,
    isTaxInclusive: false,
    description: "Synthetic flora, preserved stems, dried moss, and botanical home accents (18% GST).",
    isRecognized: true,
  },
};

// 5. EXPLICIT BIDIRECTIONAL LOOKUP MAP
// Maps every slug, itemModel, display name, and known alias to canonical TaxCategoryMetadata
const rawLookupEntries: Array<[string, TaxCategoryMetadata]> = [
  // Plants
  ["plants", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANTS]],
  ["plant", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANTS]],
  ["Plant", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANTS]],
  ["Plants", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANTS]],
  ["indoor-plants", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANTS]],
  ["outdoor-plants", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANTS]],
  ["flowering-plants", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANTS]],
  ["succulents", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANTS]],

  // Pots & Planters
  ["pots", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS]],
  ["pot", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS]],
  ["Pot", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS]],
  ["Pots", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS]],
  ["planter", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS]],
  ["planters", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS]],
  ["pots-planters", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS]],
  ["pots & planters", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS]],
  ["Pots & Planters", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS]],
  ["Pots and Planters", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.POTS]],

  // Accessories
  ["accessories", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ACCESSORIES]],
  ["accessory", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ACCESSORIES]],
  ["Accessory", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ACCESSORIES]],
  ["Accessories", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ACCESSORIES]],
  ["garden-accessories", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ACCESSORIES]],

  // Gardening Tools
  ["gardening-tools", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS]],
  ["gardening-tool", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS]],
  ["gardening tools", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS]],
  ["gardening tool", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS]],
  ["Gardening Tools", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS]],
  ["Gardening Tool", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS]],
  ["GardeningTool", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS]],
  ["GardeningTools", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS]],
  ["tools", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS]],
  ["tool", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS]],
  ["Tool", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.GARDENING_TOOLS]],

  // Plant Care
  ["plant-care", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANT_CARE]],
  ["plant care", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANT_CARE]],
  ["Plant Care", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANT_CARE]],
  ["PlantCare", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANT_CARE]],
  ["plantcare", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANT_CARE]],
  ["fertilizer", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANT_CARE]],
  ["fertilizers", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANT_CARE]],
  ["soil", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANT_CARE]],
  ["pesticide", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.PLANT_CARE]],

  // Seeds & Bulbs
  ["seeds-bulbs", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS]],
  ["seeds & bulbs", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS]],
  ["seeds and bulbs", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS]],
  ["Seeds & Bulbs", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS]],
  ["Seeds and Bulbs", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS]],
  ["SeedsBulbs", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS]],
  ["seedsbulbs", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS]],
  ["seeds", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS]],
  ["seed", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS]],
  ["Seed", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS]],
  ["Seeds", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS]],
  ["bulbs", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS]],
  ["bulb", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.SEEDS_BULBS]],

  // Plant Stands & Shelves (Canonical + Aliases)
  ["plant-stands-shelves", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["plant-stands-and-shelves", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["stands-shelves", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["stands & shelves", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["stands and shelves", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["plant-stands", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["plant stands", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["Plant Stands", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["Plant Stands & Shelves", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["PlantStandsShelves", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["PlantStand", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["plantstandsshelves", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["stands", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["stand", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["shelves", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],
  ["shelf", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.STANDS_SHELVES]],

  // Artificial & Dried Plants
  ["artificial-dried", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED]],
  ["artificial & dried", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED]],
  ["artificial and dried", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED]],
  ["artificial-dried-plants", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED]],
  ["artificial & dried plants", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED]],
  ["Artificial & Dried Plants", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED]],
  ["ArtificialDriedPlant", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED]],
  ["ArtificialPlant", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED]],
  ["artificialdriedplant", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED]],
  ["artificial", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED]],
  ["dried", CANONICAL_TAX_CATEGORIES[PRODUCT_CATEGORIES.ARTIFICIAL_DRIED]],
];

export const TAX_CATEGORY_LOOKUP = new Map<string, TaxCategoryMetadata>();

// Populate exact and lowercase entries
for (const [key, meta] of rawLookupEntries) {
  TAX_CATEGORY_LOOKUP.set(key, meta);
  TAX_CATEGORY_LOOKUP.set(key.toLowerCase(), meta);
}

/**
 * Sanitizes an input string by removing special characters, hyphens, and whitespace
 * to form a compact alphanumeric token for fuzzy-free exact key comparisons.
 */
function toCompactKey(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Pre-index compact keys for robust normalized resolution
const COMPACT_LOOKUP = new Map<string, TaxCategoryMetadata>();
for (const [key, meta] of rawLookupEntries) {
  const compact = toCompactKey(key);
  if (compact && !COMPACT_LOOKUP.has(compact)) {
    COMPACT_LOOKUP.set(compact, meta);
  }
}

/**
 * Pure, deterministic normalization function for tax categories.
 * Sanitizes input, resolves canonical metadata in O(1) time without regex or substring loops.
 * Emits a structured warning if an unknown identifier is encountered and falls back to statutory 18%.
 *
 * @param identifier Raw category slug, itemModel, or display name
 * @param productId Optional product identifier for contextual audit logging
 */
export function normalizeTaxCategory(
  identifier?: string | null,
  productId?: string | null
): TaxCategoryMetadata {
  if (!identifier || typeof identifier !== "string") {
    return { ...STATUTORY_DEFAULT_TAX };
  }

  const trimmed = identifier.trim();
  if (!trimmed) {
    return { ...STATUTORY_DEFAULT_TAX };
  }

  // 1. Direct exact or lowercase match
  const exact = TAX_CATEGORY_LOOKUP.get(trimmed) || TAX_CATEGORY_LOOKUP.get(trimmed.toLowerCase());
  if (exact) {
    return exact;
  }

  // 2. Compact alphanumeric key match (e.g. "gardening-tools" -> "gardeningtools", "Seeds & Bulbs" -> "seedsbulbs")
  const compact = toCompactKey(trimmed);
  const compactMatch = COMPACT_LOOKUP.get(compact);
  if (compactMatch) {
    return compactMatch;
  }

  // 3. Truly Unrecognized Identifier: Structured warning before falling back to 18% statutory default
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "UNRECOGNIZED_TAX_CATEGORY",
      message: `Unrecognized product category identifier "${identifier}". Falling back to statutory default 18% GST.`,
      rawIdentifier: identifier,
      compactKey: compact,
      productId: productId ? String(productId) : undefined,
      fallbackRate: STATUTORY_DEFAULT_TAX.taxPercentage,
      timestamp: new Date().toISOString(),
    })
  );

  return {
    ...STATUTORY_DEFAULT_TAX,
    category: trimmed,
  };
}

/**
 * Normalizes any category string, alias, or legacy database value into the canonical slug.
 * Returns the canonical slug (e.g. "plant-stands-shelves"), or undefined if unrecognized.
 */
export function normalizeCategorySlug(
  identifier?: string | null
): ProductCategorySlug | undefined {
  if (!identifier || typeof identifier !== "string") return undefined;
  const match = normalizeTaxCategory(identifier);
  return match.isRecognized && match.slug !== "general"
    ? (match.slug as ProductCategorySlug)
    : undefined;
}

