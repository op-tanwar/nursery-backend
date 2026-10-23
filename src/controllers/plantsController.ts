import Plant from "../models/plantsModel";
import * as factory from "./factoryController";

const allowedPlantFields = [
  "name",
  "description",
  "descriptionOption",
  "price",
  "discountPrice",
  "category",
  "stock",
  "benefits",
  "careInstructions",
  "lightRequirement",
  "wateringSchedule",
  "maintenanceLevel",
  "isPetFriendly",
  "metaTitle",
  "metaDescription",
];

export const createPlant = factory.createResource(Plant, "plants", "plantData", allowedPlantFields);
export const getAllPlants = factory.getAllResources(Plant);
export const getPlantDetails = factory.getResourceDetails(Plant);
export const updatePlant = factory.updateResource(Plant, "plants", allowedPlantFields, "plantData");
export const deletePlant = factory.deleteResource(Plant);
export const togglePlantStatus = factory.toggleResourceStatus(Plant); // ✅ Added status handler
export const createPlantReview = factory.createResourceReview(Plant, "plantId");
export const getPlantReviews = factory.getResourceReviews(Plant);
export const deleteReview = factory.deleteResourceReview(Plant, "plantId");
export const getNurseryPlants = factory.getNurseryResources(Plant);
export const getAdminAllPlants = factory.getAdminAllResources(Plant);
export const getPlantBySlug = factory.getResourceBySlug(Plant);