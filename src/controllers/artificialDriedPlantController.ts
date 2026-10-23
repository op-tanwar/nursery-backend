import Artificial from "../models/artificialDriedPlantModel";
import * as factory from "./factoryController";

const allowedArtificialFields = [
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

export const createArtificial = factory.createResource(Artificial, "artificial", "artificialData", allowedArtificialFields);
export const getAllArtificials = factory.getAllResources(Artificial);
export const getArtificialDetails = factory.getResourceDetails(Artificial);
export const updateArtificial = factory.updateResource(
  Artificial,
  "artificial",
  allowedArtificialFields,
  "artificialData"
);
export const deleteArtificial = factory.deleteResource(Artificial);
export const toggleArtificialStatus = factory.toggleResourceStatus(Artificial);
export const createArtificialReview = factory.createResourceReview(Artificial, "artificialId");
export const getArtificialReviews = factory.getResourceReviews(Artificial);
export const deleteArtificialReview = factory.deleteResourceReview(Artificial, "artificialId");
export const getNurseryArtificials = factory.getNurseryResources(Artificial);
export const getAdminAllArtificials = factory.getAdminAllResources(Artificial);
export const getArtificialBySlug = factory.getResourceBySlug(Artificial);