import express from "express";
import {
  createAccessory,
  getAllAccessories,
  getAccessoryDetails,
  getAccessoryBySlug,
  updateAccessory,
  deleteAccessory,
  toggleAccessoryStatus, // ✅ Added for Active/Inactive toggle
  createAccessoryReview,
  getAccessoryReviews,
  deleteAccessoryReview,
  getNurseryAccessories,
  getAdminAllAccessories,
} from "../controllers/accessoriesController";

import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";
import { validateProductBody, accessoryValidationSchema } from "../validations/productValidation";

const router = express.Router();

// ======================================================================
// 🌐 1️⃣ PUBLIC ROUTES 
// ======================================================================

router.route("/allAccessories").get(getAllAccessories);
router.route("/accessory/slug/:slug").get(getAccessoryBySlug);
router.route("/accessory/:id").get(getAccessoryDetails);
router.route("/accessory/reviews").get(getAccessoryReviews);

// ======================================================================
// 🏡 2️⃣ NURSERY VENDOR ROUTES 
// ======================================================================

router
  .route("/admin/accessory/new")
  .post(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(accessoryValidationSchema, "accessoryData"), createAccessory);

router
  .route("/admin/accessory/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(accessoryValidationSchema, "accessoryData"), updateAccessory)
  .delete(isAuthenticatedUser, authorizeRoles("nursery", "admin"), deleteAccessory);

// ✅ NEW: Route to toggle active/inactive status of an accessory
router
  .route("/admin/accessory/toggle/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery", "admin"), toggleAccessoryStatus);

router
  .route("/admin/my-accessories")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getNurseryAccessories);

router
  .route("/admin/all-accessories")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminAllAccessories);

// ======================================================================
// 🛍️ 3️⃣ CUSTOMER / USER ROUTES 
// ======================================================================

router.route("/accessory/review").put(isAuthenticatedUser, createAccessoryReview);
router.route("/accessory/review/delete").delete(isAuthenticatedUser, deleteAccessoryReview);

export default router;