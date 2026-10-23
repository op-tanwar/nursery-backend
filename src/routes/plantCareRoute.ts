import express from "express";
import {
  createPlantCare,
  getAllPlantCare,
  getPlantCareDetails,
  getPlantCareBySlug,
  updatePlantCare,
  deletePlantCare,
  togglePlantCareStatus,
  createPlantCareReview,
  getPlantCareReviews,
  deletePlantCareReview,
  getNurseryPlantCare,
  getAdminAllPlantCare,
} from "../controllers/plantCareController";

import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";
import {
  validateProductBody,
  plantCareValidationSchema,
} from "../validations/productValidation";

const router = express.Router();

// ======================================================================
// 🌐 1️⃣ PUBLIC ROUTES
// ======================================================================

router.route("/allPlantCare").get(getAllPlantCare);
router.route("/plantCare/slug/:slug").get(getPlantCareBySlug);
router.route("/plantCare/:id").get(getPlantCareDetails);
router.route("/reviews").get(getPlantCareReviews);

// ======================================================================
// 🏡 2️⃣ NURSERY VENDOR ROUTES
// ======================================================================

router
  .route("/admin/plantCare/new")
  .post(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(plantCareValidationSchema, "plantCareData"), createPlantCare);

router
  .route("/admin/plantCare/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(plantCareValidationSchema, "plantCareData"), updatePlantCare)
  .delete(isAuthenticatedUser, authorizeRoles("nursery", "admin"), deletePlantCare);

router
  .route("/admin/plantCare/toggle/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery", "admin"), togglePlantCareStatus);

router
  .route("/admin/my-plantCare")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getNurseryPlantCare);

router
  .route("/admin/all-plantCare")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminAllPlantCare);

// ======================================================================
// 🛍️ 3️⃣ CUSTOMER / USER ROUTES
// ======================================================================

router.route("/review").put(isAuthenticatedUser, createPlantCareReview);
router.route("/review/delete").delete(isAuthenticatedUser, deletePlantCareReview);

export default router;