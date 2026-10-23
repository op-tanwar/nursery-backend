import GardeningTool from "../models/gardeningToolsModel";
import * as factory from "./factoryController";

const allowedGardeningToolFields = [
  "name",
  "description",
  "descriptionOption",
  "price",
  "discountPrice",
  "category",
  "stock",
  "features",
  "material",
  "handleMaterial",
  "warrantyMonths",
  "metaTitle",
  "metaDescription",
];

export const createGardeningTool = factory.createResource(
  GardeningTool,
  "gardening-tools",
  "gardeningToolData",
  allowedGardeningToolFields
);
export const getAllGardeningTools = factory.getAllResources(GardeningTool);
export const getGardeningToolDetails = factory.getResourceDetails(GardeningTool);
export const updateGardeningTool = factory.updateResource(
  GardeningTool,
  "gardening-tools",
  allowedGardeningToolFields,
  "gardeningToolData"
);
export const deleteGardeningTool = factory.deleteResource(GardeningTool);
export const toggleGardeningToolStatus = factory.toggleResourceStatus(GardeningTool);
export const createGardeningToolReview = factory.createResourceReview(
  GardeningTool,
  "gardeningToolId"
);
export const getGardeningToolReviews = factory.getResourceReviews(GardeningTool);
export const deleteGardeningToolReview = factory.deleteResourceReview(
  GardeningTool,
  "gardeningToolId"
);
export const getNurseryGardeningTools = factory.getNurseryResources(GardeningTool);
export const getAdminAllGardeningTools = factory.getAdminAllResources(GardeningTool);
export const getGardeningToolBySlug = factory.getResourceBySlug(GardeningTool);