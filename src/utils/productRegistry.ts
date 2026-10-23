import { Model } from "mongoose";
import Plant from "../models/plantsModel";
import Pot from "../models/potsModel";
import Accessory from "../models/accessoriesModel";
import GardeningTool from "../models/gardeningToolsModel";
import PlantCare from "../models/plantCareModel";
import SeedsBulbs from "../models/seedsBulbsModel";
import PlantStandsShelves from "../models/plantStandsShelvesModel";
import ArtificialDriedPlant from "../models/artificialDriedPlantModel";

/** All commerce-capable product model names (Mongoose modelName / itemModel enum). */
export const PRODUCT_MODEL_NAMES = [
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

export const modelRegistry: Record<ProductModelName, Model<any>> = {
  Plant,
  Pot,
  Accessory,
  GardeningTool,
  PlantCare,
  SeedsBulbs,
  PlantStandsShelves,
  ArtificialDriedPlant,
};

/** Response JSON keys used by factoryController (must match frontend expectations). */
export const RESOURCE_RESPONSE_KEYS: Record<
  string,
  { singular: string; plural: string }
> = {
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
  RESOURCE_RESPONSE_KEYS[modelName]?.singular ?? modelName.toLowerCase();

export const getPluralKey = (modelName: string): string => {
  if (RESOURCE_RESPONSE_KEYS[modelName]) {
    return RESOURCE_RESPONSE_KEYS[modelName].plural;
  }
  const lower = modelName.toLowerCase();
  return lower.endsWith("y") ? `${lower.slice(0, -1)}ies` : `${lower}s`;
};

/** totalX key in list responses (e.g. totalPlants, totalPlantCare) */
export const getTotalCountKey = (modelName: string): string => {
  const totals: Record<string, string> = {
    Plant: "totalPlants",
    Pot: "totalPots",
    Accessory: "totalAccessories",
    GardeningTool: "totalGardeningTools",
    PlantCare: "totalPlantCare",
    SeedsBulbs: "totalSeedsBulbs",
    PlantStandsShelves: "totalPlantStandsShelves",
    ArtificialDriedPlant: "totalArtificials",
  };
  return totals[modelName] ?? `total${modelName}s`;
};

export const getCaseInsensitiveModel = (
  modelName: string
): Model<any> | null => {
  if (!modelName) return null;
  const matchKey = PRODUCT_MODEL_NAMES.find(
    (key) => key.toLowerCase() === modelName.toLowerCase()
  );
  return matchKey ? modelRegistry[matchKey] : null;
};

/** Resolve a product id against every catalog collection (order: mature → new). */
export const findProductAndModel = async (id: string) => {
  for (const modelName of PRODUCT_MODEL_NAMES) {
    const product = await modelRegistry[modelName].findById(id);
    if (product) return { product, modelName };
  }
  return { product: null, modelName: null as ProductModelName | null };
};

/**
 * Resolve product and its model securely from MongoDB using either
 * explicit modelName or falling back across the registry.
 */
export const resolveProductAndModel = async (
  id: string,
  modelName?: string
): Promise<{ product: any; modelName: ProductModelName | null }> => {
  if (modelName) {
    const Model = getCaseInsensitiveModel(modelName);
    if (Model) {
      const product = await Model.findById(id);
      if (product) {
        const canonical = PRODUCT_MODEL_NAMES.find(
          (m) => m.toLowerCase() === modelName.toLowerCase()
        ) || (modelName as ProductModelName);
        return { product, modelName: canonical };
      }
    }
  }
  return await findProductAndModel(id);
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
  "artificial-dried-plants": "ArtificialDriedPlant",
};

export const MODEL_TO_SHOP_TYPE: Record<ProductModelName, string> = {
  Plant: "plants",
  Pot: "pots",
  Accessory: "accessories",
  GardeningTool: "gardening-tools",
  PlantCare: "plant-care",
  SeedsBulbs: "seeds-bulbs",
  PlantStandsShelves: "plant-stands-shelves",
  ArtificialDriedPlant: "artificial-dried-plants",
};
