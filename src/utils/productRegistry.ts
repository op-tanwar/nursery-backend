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

/** Resolve a product id against the unified Product collection in O(1) */
export const findProductAndModel = async (id: string) => {
  const product = await Product.findById(id);
  if (product) return { product, modelName: "Product" as ProductModelName };
  return { product: null, modelName: null };
};

/** Resolve product and its model securely from MongoDB using the unified Product model */
export const resolveProductAndModel = async (
  id: string,
  _modelName?: string
): Promise<{ product: any; modelName: ProductModelName | null }> => {
  return await findProductAndModel(id);
};

/** URL segment ↔ model name for shop routes */
export const SHOP_TYPE_TO_MODEL: Record<string, ProductModelName> = {
  plants: "Product",
  pots: "Product",
  accessories: "Product",
  "gardening-tools": "Product",
  "plant-care": "Product",
  "seeds-bulbs": "Product",
  "plant-stands-shelves": "Product",
  "artificial-dried-plants": "Product",
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
