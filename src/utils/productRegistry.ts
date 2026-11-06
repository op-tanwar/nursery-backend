import { Model } from "mongoose";
import Product from "../models/productModel";

/** All commerce-capable product model names (Mongoose modelName / itemModel enum). */
export const PRODUCT_MODEL_NAMES = [
  "Product",
  "Plant",
  "Pot",
  "Accessory",
  "GardeningTool",
  "PlantCare",
  "SeedsBulbs",
  "PlantStandsShelves",
  "ArtificialDriedPlant",
] as const;

export type ProductModelName = (typeof PRODUCT_MODEL_NAMES)[number];

/** Consolidated registry mapping all catalog names to the unified Product model */
export const modelRegistry: Record<string, Model<any>> = {
  Product,
  Plant: Product,
  Pot: Product,
  Accessory: Product,
  GardeningTool: Product,
  PlantCare: Product,
  SeedsBulbs: Product,
  PlantStandsShelves: Product,
  ArtificialDriedPlant: Product,
};

/**
 * 🏷️ Normalized mapping from category slugs, DB category strings, and synonyms
 * to canonical ProductModelName.
 */
export const CATEGORY_TO_MODEL_NAME: Record<string, ProductModelName> = {
  // Plants (30% baseline)
  plant: "Plant",
  plants: "Plant",
  indoor: "Plant",
  outdoor: "Plant",
  flowering: "Plant",
  succulents: "Plant",

  // Pots & Planters (25%)
  pot: "Pot",
  pots: "Pot",
  planter: "Pot",
  planters: "Pot",
  "pots-planters": "Pot",
  "pots & planters": "Pot",

  // Accessories (20%)
  accessory: "Accessory",
  accessories: "Accessory",

  // Gardening Tools (20%)
  "gardening-tools": "GardeningTool",
  "gardening tools": "GardeningTool",
  gardeningtool: "GardeningTool",
  gardeningtools: "GardeningTool",
  tools: "GardeningTool",
  tool: "GardeningTool",

  // Plant Care (20%)
  "plant-care": "PlantCare",
  "plant care": "PlantCare",
  plantcare: "PlantCare",
  fertilizer: "PlantCare",
  soil: "PlantCare",

  // Seeds & Bulbs (20%)
  "seeds-bulbs": "SeedsBulbs",
  "seeds & bulbs": "SeedsBulbs",
  seedsbulbs: "SeedsBulbs",
  seeds: "SeedsBulbs",
  seed: "SeedsBulbs",
  bulbs: "SeedsBulbs",
  bulb: "SeedsBulbs",

  // Plant Stands & Shelves (20%)
  "stands-shelves": "PlantStandsShelves",
  "stands & shelves": "PlantStandsShelves",
  "plant-stands-shelves": "PlantStandsShelves",
  "plant-stands-and-shelves": "PlantStandsShelves",
  "plant stands": "PlantStandsShelves",
  "plant-stands": "PlantStandsShelves",
  plantstandsshelves: "PlantStandsShelves",
  stand: "PlantStandsShelves",
  stands: "PlantStandsShelves",
  shelves: "PlantStandsShelves",
  shelf: "PlantStandsShelves",

  // Artificial & Dried Plants (20%)
  "artificial-dried": "ArtificialDriedPlant",
  "artificial-dried-plants": "ArtificialDriedPlant",
  "artificial & dried": "ArtificialDriedPlant",
  "artificial & dried plants": "ArtificialDriedPlant",
  artificialdriedplant: "ArtificialDriedPlant",
  artificial: "ArtificialDriedPlant",
  dried: "ArtificialDriedPlant",
};

/**
 * 🛡️ Authoritative polymorphic commission model resolver.
 * Extracts the true model / category discriminator from product documents
 * to ensure non-plant items (Pots: 25%, Tools: 20%, etc.) are not overcharged at 30%.
 *
 * Resolution Priority:
 *  1. Explicit discriminator key: product.__t or product.itemModel (if valid & not generic "Product")
 *  2. Normalized category mapping (e.g. "gardening-tools" -> "GardeningTool", "pots" -> "Pot")
 *  3. Constructor modelName check (if subclassed)
 *  4. External hintModel parameter (if passed and valid)
 *  5. Defensive Fallback: "Product" (with structured warning)
 */
export function resolveProductCommissionType(
  product?: any,
  hintModel?: string
): ProductModelName {
  if (!product && !hintModel) {
    return "Product";
  }

  // 1. Explicit discriminator key: product.__t or product.itemModel (ignoring generic "Product")
  const rawDiscriminator = product?.__t || product?.itemModel;
  if (rawDiscriminator && typeof rawDiscriminator === "string") {
    const trimmed = rawDiscriminator.trim();
    if (trimmed && trimmed.toLowerCase() !== "product") {
      const normalized = CATEGORY_TO_MODEL_NAME[trimmed.toLowerCase()];
      if (normalized) return normalized;
      const matched = PRODUCT_MODEL_NAMES.find(
        (m) => m.toLowerCase() === trimmed.toLowerCase()
      );
      if (matched && matched !== "Product") return matched;
    }
  }

  // 2. Normalized category mapping: product.category / product.productCategory / product.type
  const rawCategory =
    product?.category || product?.productCategory || product?.type;
  if (rawCategory && typeof rawCategory === "string") {
    const trimmedCat = rawCategory.trim().toLowerCase();
    const mapped = CATEGORY_TO_MODEL_NAME[trimmedCat];
    if (mapped) return mapped;

    // Partial / substring keyword match
    for (const [catKey, model] of Object.entries(CATEGORY_TO_MODEL_NAME)) {
      if (trimmedCat.includes(catKey) || catKey.includes(trimmedCat)) {
        return model;
      }
    }
  }

  // 3. Constructor modelName check (avoiding generic "model", "Product", "Object")
  const ctorModelName = product?.constructor?.modelName;
  if (ctorModelName && typeof ctorModelName === "string") {
    const trimmedCtor = ctorModelName.trim();
    if (
      trimmedCtor &&
      !["model", "product", "object", "query"].includes(trimmedCtor.toLowerCase())
    ) {
      const normalized = CATEGORY_TO_MODEL_NAME[trimmedCtor.toLowerCase()];
      if (normalized) return normalized;
      const matched = PRODUCT_MODEL_NAMES.find(
        (m) => m.toLowerCase() === trimmedCtor.toLowerCase()
      );
      if (matched && matched !== "Product") return matched;
    }
  }

  // 4. External hintModel fallback (if provided and non-generic)
  if (hintModel && typeof hintModel === "string") {
    const trimmedHint = hintModel.trim();
    if (trimmedHint && trimmedHint.toLowerCase() !== "product") {
      const normalized = CATEGORY_TO_MODEL_NAME[trimmedHint.toLowerCase()];
      if (normalized) return normalized;
      const matched = PRODUCT_MODEL_NAMES.find(
        (m) => m.toLowerCase() === trimmedHint.toLowerCase()
      );
      if (matched && matched !== "Product") return matched;
    }
  }

  // 5. Defensive fallback
  if (product && product._id) {
    console.warn("⚠️ [resolveProductCommissionType] Could not resolve polymorphic model for product. Falling back to default:", {
      productId: String(product._id),
      name: product.name,
      category: product.category,
      discriminator: product.__t || product.itemModel,
    });
  }

  return "Product";
}

/** Response JSON keys */
export const RESOURCE_RESPONSE_KEYS: Record<
  string,
  { singular: string; plural: string }
> = {
  Product: { singular: "product", plural: "products" },
  Plant: { singular: "plant", plural: "plants" },
  Pot: { singular: "pot", plural: "pots" },
  Accessory: { singular: "accessory", plural: "accessories" },
  GardeningTool: { singular: "gardeningTool", plural: "gardeningTools" },
  PlantCare: { singular: "plantCare", plural: "plantCare" },
  SeedsBulbs: { singular: "seedsBulbs", plural: "seedsBulbs" },
  PlantStandsShelves: {
    singular: "plantStandsShelves",
    plural: "plantStandsShelves",
  },
  ArtificialDriedPlant: { singular: "artificialDriedPlant", plural: "artificials" },
};

export const getSingularKey = (modelName: string): string =>
  RESOURCE_RESPONSE_KEYS[modelName]?.singular ?? "product";

export const getPluralKey = (modelName: string): string =>
  RESOURCE_RESPONSE_KEYS[modelName]?.plural ?? "products";

export const getTotalCountKey = (modelName: string): string =>
  `total${modelName || "Product"}s`;

export const getCaseInsensitiveModel = (_modelName?: string): Model<any> => Product;

/** Resolve a product id against the unified Product collection in O(1) with dynamic polymorphic model */
export const findProductAndModel = async (id: string, hintModel?: string) => {
  const product = await Product.findById(id);
  if (product) {
    const modelName = resolveProductCommissionType(product, hintModel);
    return { product, modelName };
  }
  return { product: null, modelName: null };
};

/** Resolve product and its model securely from MongoDB using the unified Product model */
export const resolveProductAndModel = async (
  id: string,
  hintModel?: string
): Promise<{ product: any; modelName: ProductModelName | null }> => {
  return await findProductAndModel(id, hintModel);
};

/** URL segment ↔ model name for shop routes */
export const SHOP_TYPE_TO_MODEL: Record<string, ProductModelName> = {
  plants: "Plant",
  pots: "Pot",
  accessories: "Accessory",
  "gardening-tools": "GardeningTool",
  "plant-care": "PlantCare",
  "seeds-bulbs": "SeedsBulbs",
  "plant-stands-shelves": "PlantStandsShelves",
  "stands-shelves": "PlantStandsShelves",
  "plant-stands-and-shelves": "PlantStandsShelves",
  "artificial-dried-plants": "ArtificialDriedPlant",
};

export const MODEL_TO_SHOP_TYPE: Record<string, string> = {
  Product: "products",
  Plant: "plants",
  Pot: "pots",
  Accessory: "accessories",
  GardeningTool: "gardening-tools",
  PlantCare: "plant-care",
  SeedsBulbs: "seeds-bulbs",
  PlantStandsShelves: "plant-stands-shelves",
  ArtificialDriedPlant: "artificial-dried-plants",
};
