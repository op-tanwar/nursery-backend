import PlantStandsShelves from "../models/plantStandsShelvesModel";
import * as factory from "./factoryController";

const allowedPlantStandsShelvesFields = [
  "name",
  "description",
  "descriptionOption",
  "price",
  "discountPrice",
  "category",
  "stock",
  "material",
  "dimensions",
  "tierCount",
  "maxLoadCapacity",
  "metaTitle",
  "metaDescription",
];

export const createPlantStandsShelves = factory.createResource(
  PlantStandsShelves,
  "plant-stands-shelves",
  "plantStandsShelvesData",
  allowedPlantStandsShelvesFields
);
export const getAllPlantStandsShelves = factory.getAllResources(PlantStandsShelves);
export const getPlantStandsShelvesDetails = factory.getResourceDetails(PlantStandsShelves);
export const updatePlantStandsShelves = factory.updateResource(
  PlantStandsShelves,
  "plant-stands-shelves",
  allowedPlantStandsShelvesFields,
  "plantStandsShelvesData"
);
export const deletePlantStandsShelves = factory.deleteResource(PlantStandsShelves);
export const togglePlantStandsShelvesStatus = factory.toggleResourceStatus(PlantStandsShelves);
export const createPlantStandsShelvesReview = factory.createResourceReview(
  PlantStandsShelves,
  "plantStandsShelvesId"
);
export const getPlantStandsShelvesReviews = factory.getResourceReviews(PlantStandsShelves);
export const deletePlantStandsShelvesReview = factory.deleteResourceReview(
  PlantStandsShelves,
  "plantStandsShelvesId"
);
export const getNurseryPlantStandsShelves = factory.getNurseryResources(PlantStandsShelves);
export const getAdminAllPlantStandsShelves = factory.getAdminAllResources(PlantStandsShelves);
export const getPlantStandsShelvesBySlug = factory.getResourceBySlug(PlantStandsShelves);