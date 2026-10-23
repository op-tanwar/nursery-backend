import express from "express";
import {
  getAllCategoryCommissions,
  createCategoryCommission,
  updateCategoryCommission,
  bulkUpdateCategoryCommissions,
  resetDefaultCommissions,
  deleteCategoryCommission,
} from "../controllers/commissionController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";

const router = express.Router();

// Public / Authenticated read endpoint
router.route("/").get(getAllCategoryCommissions);

// Admin-protected create & bulk update endpoints
router
  .route("/")
  .post(isAuthenticatedUser, authorizeRoles("admin"), createCategoryCommission)
  .patch(isAuthenticatedUser, authorizeRoles("admin"), bulkUpdateCategoryCommissions);

// Admin single-item manage routes
router
  .route("/:id")
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateCategoryCommission)
  .patch(isAuthenticatedUser, authorizeRoles("admin"), updateCategoryCommission)
  .delete(isAuthenticatedUser, authorizeRoles("admin"), deleteCategoryCommission);

// Admin reset endpoints
router
  .route("/reset")
  .post(isAuthenticatedUser, authorizeRoles("admin"), resetDefaultCommissions);

router
  .route("/reset/defaults")
  .post(isAuthenticatedUser, authorizeRoles("admin"), resetDefaultCommissions);

export default router;
