import Accessory from "../models/accessoriesModel";
import * as factory from "./factoryController";

const allowedAccessoryFields = [
  "name",
  "description",
  "descriptionOption",
  "price",
  "discountPrice",
  "category",
  "stock",
  "specifications",
  "metaTitle",
  "metaDescription",
];

export const createAccessory = factory.createResource(Accessory, "accessories", "accessoryData", allowedAccessoryFields);
export const getAllAccessories = factory.getAllResources(Accessory);
export const getAccessoryDetails = factory.getResourceDetails(Accessory);
export const updateAccessory = factory.updateResource(Accessory, "accessories", allowedAccessoryFields, "accessoryData");
export const deleteAccessory = factory.deleteResource(Accessory);
export const toggleAccessoryStatus = factory.toggleResourceStatus(Accessory); // ✅ Added status handler
export const createAccessoryReview = factory.createResourceReview(Accessory, "accessoryId");
export const getAccessoryReviews = factory.getResourceReviews(Accessory);
export const deleteAccessoryReview = factory.deleteResourceReview(Accessory, "accessoryId");
export const getNurseryAccessories = factory.getNurseryResources(Accessory);
export const getAdminAllAccessories = factory.getAdminAllResources(Accessory);
export const getAccessoryBySlug = factory.getResourceBySlug(Accessory);