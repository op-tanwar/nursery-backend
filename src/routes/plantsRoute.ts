import express from "express";
import {
  createPlant,
  getAllPlants,
  getPlantDetails,
  getPlantBySlug,
  updatePlant,
  deletePlant,
  togglePlantStatus, // ✅ Added for Active/Inactive toggle
  createPlantReview,
  getPlantReviews,
  deleteReview,
  getNurseryPlants,
  getAdminAllPlants,
} from "../controllers/plantsController";

import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";
import { validateProductBody, plantValidationSchema } from "../validations/productValidation";

const router = express.Router();

// ======================================================================
// 🌐 1️⃣ PUBLIC ROUTES 
// ======================================================================

router.route("/plant/slug/:slug").get(getPlantBySlug);
router.route("/allPlants").get(getAllPlants);
router.route("/plant/:id").get(getPlantDetails);
router.route("/reviews").get(getPlantReviews);

// ======================================================================
// 🏡 2️⃣ NURSERY VENDOR ROUTES 
// ======================================================================

router
  .route("/admin/plant/new")
  .post(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(plantValidationSchema, "plantData"), createPlant);

router
  .route("/admin/plant/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(plantValidationSchema, "plantData"), updatePlant)
  .delete(isAuthenticatedUser, authorizeRoles("nursery", "admin"), deletePlant);

// ✅ NEW: Route to toggle active/inactive status of a plant
router
  .route("/admin/plant/toggle/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery", "admin"), togglePlantStatus);

router
  .route("/admin/my-plants")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getNurseryPlants);

router
  .route("/admin/all-plants")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminAllPlants);

// ======================================================================
// 🛍️ 3️⃣ CUSTOMER / USER ROUTES 
// ======================================================================

router.route("/review").put(isAuthenticatedUser, createPlantReview);
router.route("/review/delete").delete(isAuthenticatedUser, deleteReview);

export default router;