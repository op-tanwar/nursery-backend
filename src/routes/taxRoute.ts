import express from "express";
import {
  getAllCategoryTaxes,
  createCategoryTax,
  updateCategoryTax,
  bulkUpdateCategoryTaxes,
  resetDefaultTaxes,
  deleteCategoryTax,
} from "../controllers/taxController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";

const router = express.Router();

// Public / Authenticated read endpoint (Cart & Checkout dynamic tax display)
router.route("/").get(getAllCategoryTaxes);

// Admin-protected create & bulk update endpoints
router
  .route("/")
  .post(isAuthenticatedUser, authorizeRoles("admin"), createCategoryTax)
  .patch(isAuthenticatedUser, authorizeRoles("admin"), bulkUpdateCategoryTaxes);

// Admin single-item manage routes
router
  .route("/:id")
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateCategoryTax)
  .patch(isAuthenticatedUser, authorizeRoles("admin"), updateCategoryTax)
  .delete(isAuthenticatedUser, authorizeRoles("admin"), deleteCategoryTax);

// Admin reset endpoints (supports both /reset and /reset/defaults)
router
  .route("/reset")
  .post(isAuthenticatedUser, authorizeRoles("admin"), resetDefaultTaxes);

router
  .route("/reset/defaults")
  .post(isAuthenticatedUser, authorizeRoles("admin"), resetDefaultTaxes);

export default router;
