import Pot from "../models/potsModel";
import * as factory from "./factoryController";

const allowedPotFields = [
  "name",
  "description",
  "descriptionOption",
  "price",
  "discountPrice",
  "category",
  "stock",
  "material",
  "color",
  "dimensions",
  "hasDrainageHole",
  "shape",
  "isIndoorOutdoor",
  "includesSaucer",
  "metaTitle",
  "metaDescription",
];

export const createPot = factory.createResource(Pot, "pots", "potData", allowedPotFields);
export const getAllPots = factory.getAllResources(Pot);
export const getPotDetails = factory.getResourceDetails(Pot);
export const updatePot = factory.updateResource(Pot, "pots", allowedPotFields, "potData");
export const deletePot = factory.deleteResource(Pot);
export const togglePotStatus = factory.toggleResourceStatus(Pot); // ✅ Added status handler
export const createPotReview = factory.createResourceReview(Pot, "potId");
export const getPotReviews = factory.getResourceReviews(Pot);
export const deletePotReview = factory.deleteResourceReview(Pot, "potId");
export const getNurseryPots = factory.getNurseryResources(Pot);
export const getAdminAllPots = factory.getAdminAllResources(Pot);
export const getPotBySlug = factory.getResourceBySlug(Pot);