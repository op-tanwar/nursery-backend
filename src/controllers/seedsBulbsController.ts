import SeedsBulbs from "../models/seedsBulbsModel";
import * as factory from "./factoryController";

const allowedSeedsBulbsFields = [
  "name",
  "description",
  "descriptionOption",
  "price",
  "discountPrice",
  "category",
  "stock",
  "sowingSeason",
  "germinationTime",
  "quantityPerPack",
  "metaTitle",
  "metaDescription",
];

export const createSeedsBulbs = factory.createResource(
  SeedsBulbs,
  "seeds-bulbs",
  "seedsBulbsData",
  allowedSeedsBulbsFields
);
export const getAllSeedsBulbs = factory.getAllResources(SeedsBulbs);
export const getSeedsBulbsDetails = factory.getResourceDetails(SeedsBulbs);
export const updateSeedsBulbs = factory.updateResource(
  SeedsBulbs,
  "seeds-bulbs",
  allowedSeedsBulbsFields,
  "seedsBulbsData"
);
export const deleteSeedsBulbs = factory.deleteResource(SeedsBulbs);
export const toggleSeedsBulbsStatus = factory.toggleResourceStatus(SeedsBulbs);
export const createSeedsBulbsReview = factory.createResourceReview(
  SeedsBulbs,
  "seedsBulbsId"
);
export const getSeedsBulbsReviews = factory.getResourceReviews(SeedsBulbs);
export const deleteSeedsBulbsReview = factory.deleteResourceReview(
  SeedsBulbs,
  "seedsBulbsId"
);
export const getNurserySeedsBulbs = factory.getNurseryResources(SeedsBulbs);
export const getAdminAllSeedsBulbs = factory.getAdminAllResources(SeedsBulbs);
export const getSeedsBulbsBySlug = factory.getResourceBySlug(SeedsBulbs);