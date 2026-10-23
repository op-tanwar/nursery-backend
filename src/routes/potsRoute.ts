import express from "express";
import {
  createPot,
  getAllPots,
  getPotDetails,
  getPotBySlug,
  updatePot,
  deletePot,
  togglePotStatus, // ✅ Added for Active/Inactive toggle
  createPotReview,
  getPotReviews,
  deletePotReview,
  getNurseryPots,
  getAdminAllPots,
} from "../controllers/potsController";

import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";
import { validateProductBody, potValidationSchema } from "../validations/productValidation";

const router = express.Router();

// ======================================================================
// 🌐 1️⃣ PUBLIC ROUTES 
// ======================================================================

router.route("/pot/slug/:slug").get(getPotBySlug);
router.route("/allPots").get(getAllPots);
router.route("/pot/:id").get(getPotDetails);
router.route("/pot/reviews").get(getPotReviews);

// ======================================================================
// 🏡 2️⃣ NURSERY VENDOR ROUTES 
// ======================================================================

router
  .route("/admin/pot/new")
  .post(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(potValidationSchema, "potData"), createPot);

router
  .route("/admin/pot/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(potValidationSchema, "potData"), updatePot)
  .delete(isAuthenticatedUser, authorizeRoles("nursery", "admin"), deletePot);

// ✅ NEW: Route to toggle active/inactive status of a pot
router
  .route("/admin/pot/toggle/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery", "admin"), togglePotStatus);

router
  .route("/admin/my-pots")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getNurseryPots);

router
  .route("/admin/all-pots")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminAllPots);

// ======================================================================
// 🛍️ 3️⃣ CUSTOMER / USER ROUTES 
// ======================================================================

router.route("/pot/review").put(isAuthenticatedUser, createPotReview);
router.route("/pot/review/delete").delete(isAuthenticatedUser, deletePotReview);

export default router;