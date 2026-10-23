import PlantCare from "../models/plantCareModel";
import * as factory from "./factoryController";

const allowedPlantCareFields = [
  "name",
  "description",
  "descriptionOption",
  "price",
  "discountPrice",
  "category",
  "stock",
  "howToUse",
  "composition",
  "volumeOrWeight",
  "formType",
  "isOrganic",
  "metaTitle",
  "metaDescription",
];

export const createPlantCare = factory.createResource(
  PlantCare,
  "plant-care",
  "plantCareData",
  allowedPlantCareFields
);
export const getAllPlantCare = factory.getAllResources(PlantCare);
export const getPlantCareDetails = factory.getResourceDetails(PlantCare);
export const updatePlantCare = factory.updateResource(
  PlantCare,
  "plant-care",
  allowedPlantCareFields,
  "plantCareData"
);
export const deletePlantCare = factory.deleteResource(PlantCare);
export const togglePlantCareStatus = factory.toggleResourceStatus(PlantCare);
export const createPlantCareReview = factory.createResourceReview(
  PlantCare,
  "plantCareId"
);
export const getPlantCareReviews = factory.getResourceReviews(PlantCare);
export const deletePlantCareReview = factory.deleteResourceReview(
  PlantCare,
  "plantCareId"
);
export const getNurseryPlantCare = factory.getNurseryResources(PlantCare);
export const getAdminAllPlantCare = factory.getAdminAllResources(PlantCare);
export const getPlantCareBySlug = factory.getResourceBySlug(PlantCare);