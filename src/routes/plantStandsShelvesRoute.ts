import express from "express";
import {
  createPlantStandsShelves,
  getAllPlantStandsShelves,
  getPlantStandsShelvesDetails,
  getPlantStandsShelvesBySlug,
  updatePlantStandsShelves,
  deletePlantStandsShelves,
  togglePlantStandsShelvesStatus,
  createPlantStandsShelvesReview,
  getPlantStandsShelvesReviews,
  deletePlantStandsShelvesReview,
  getNurseryPlantStandsShelves,
  getAdminAllPlantStandsShelves,
} from "../controllers/plantStandsShelvesController";

import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";
import {
  validateProductBody,
  plantStandsShelvesValidationSchema,
} from "../validations/productValidation";

const router = express.Router();

// ======================================================================
// 🌐 1️⃣ PUBLIC ROUTES
// ======================================================================

router.route("/allPlantStandsShelves").get(getAllPlantStandsShelves);
router.route("/plantStandsShelves/slug/:slug").get(getPlantStandsShelvesBySlug);
router.route("/plantStandsShelves/:id").get(getPlantStandsShelvesDetails);
router.route("/reviews").get(getPlantStandsShelvesReviews);

// ======================================================================
// 🏡 2️⃣ NURSERY VENDOR ROUTES
// ======================================================================

router
  .route("/admin/plantStandsShelves/new")
  .post(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(plantStandsShelvesValidationSchema, "plantStandsShelvesData"), createPlantStandsShelves);

router
  .route("/admin/plantStandsShelves/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(plantStandsShelvesValidationSchema, "plantStandsShelvesData"), updatePlantStandsShelves)
  .delete(isAuthenticatedUser, authorizeRoles("nursery", "admin"), deletePlantStandsShelves);

router
  .route("/admin/plantStandsShelves/toggle/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery", "admin"), togglePlantStandsShelvesStatus);

router
  .route("/admin/my-plantStandsShelves")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getNurseryPlantStandsShelves);

router
  .route("/admin/all-plantStandsShelves")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminAllPlantStandsShelves);

// ======================================================================
// 🛍️ 3️⃣ CUSTOMER / USER ROUTES
// ======================================================================

router.route("/review").put(isAuthenticatedUser, createPlantStandsShelvesReview);
router.route("/review/delete").delete(isAuthenticatedUser, deletePlantStandsShelvesReview);

export default router;