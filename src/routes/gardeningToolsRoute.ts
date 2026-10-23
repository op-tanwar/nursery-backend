import express from "express";
import {
  createGardeningTool,
  getAllGardeningTools,
  getGardeningToolDetails,
  getGardeningToolBySlug,
  updateGardeningTool,
  deleteGardeningTool,
  toggleGardeningToolStatus,
  createGardeningToolReview,
  getGardeningToolReviews,
  deleteGardeningToolReview,
  getNurseryGardeningTools,
  getAdminAllGardeningTools,
} from "../controllers/gardeningToolsController";

import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";
import {
  validateProductBody,
  gardeningToolValidationSchema,
} from "../validations/productValidation";

const router = express.Router();

// ======================================================================
// 🌐 1️⃣ PUBLIC ROUTES
// ======================================================================

router.route("/allGardeningTools").get(getAllGardeningTools);
router.route("/gardeningTool/slug/:slug").get(getGardeningToolBySlug);
router.route("/gardeningTool/:id").get(getGardeningToolDetails);
router.route("/reviews").get(getGardeningToolReviews);

// ======================================================================
// 🏡 2️⃣ NURSERY VENDOR ROUTES
// ======================================================================

router
  .route("/admin/gardeningTool/new")
  .post(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(gardeningToolValidationSchema, "gardeningToolData" ), createGardeningTool);

router
  .route("/admin/gardeningTool/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(gardeningToolValidationSchema, "gardeningToolData"), updateGardeningTool)
  .delete(isAuthenticatedUser, authorizeRoles("nursery", "admin"), deleteGardeningTool);

router
  .route("/admin/gardeningTool/toggle/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery", "admin"), toggleGardeningToolStatus);

router
  .route("/admin/my-gardeningTools")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getNurseryGardeningTools);

router
  .route("/admin/all-gardeningTools")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminAllGardeningTools);

// ======================================================================
// 🛍️ 3️⃣ CUSTOMER / USER ROUTES
// ======================================================================

router.route("/review").put(isAuthenticatedUser, createGardeningToolReview);
router.route("/review/delete").delete(isAuthenticatedUser, deleteGardeningToolReview);

export default router;