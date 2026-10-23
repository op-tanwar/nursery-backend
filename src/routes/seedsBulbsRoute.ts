import express from "express";
import {
  createSeedsBulbs,
  getAllSeedsBulbs,
  getSeedsBulbsDetails,
  getSeedsBulbsBySlug,
  updateSeedsBulbs,
  deleteSeedsBulbs,
  toggleSeedsBulbsStatus,
  createSeedsBulbsReview,
  getSeedsBulbsReviews,
  deleteSeedsBulbsReview,
  getNurserySeedsBulbs,
  getAdminAllSeedsBulbs,
} from "../controllers/seedsBulbsController";

import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";
import {
  validateProductBody,
  seedsBulbsValidationSchema,
} from "../validations/productValidation";

const router = express.Router();

// ======================================================================
// 🌐 1️⃣ PUBLIC ROUTES
// ======================================================================

router.route("/allSeedsBulbs").get(getAllSeedsBulbs);
router.route("/seedsBulbs/slug/:slug").get(getSeedsBulbsBySlug);
router.route("/seedsBulbs/:id").get(getSeedsBulbsDetails);
router.route("/reviews").get(getSeedsBulbsReviews);

// ======================================================================
// 🏡 2️⃣ NURSERY VENDOR ROUTES
// ======================================================================

router
  .route("/admin/seedsBulbs/new")
  .post(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(seedsBulbsValidationSchema, "seedsBulbsData"), createSeedsBulbs);

router
  .route("/admin/seedsBulbs/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(seedsBulbsValidationSchema, "seedsBulbsData"), updateSeedsBulbs)
  .delete(isAuthenticatedUser, authorizeRoles("nursery", "admin"), deleteSeedsBulbs);

router
  .route("/admin/seedsBulbs/toggle/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery", "admin"), toggleSeedsBulbsStatus);

router
  .route("/admin/my-seedsBulbs")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getNurserySeedsBulbs);

router
  .route("/admin/all-seedsBulbs")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminAllSeedsBulbs);

// ======================================================================
// 🛍️ 3️⃣ CUSTOMER / USER ROUTES
// ======================================================================

router.route("/review").put(isAuthenticatedUser, createSeedsBulbsReview);
router.route("/review/delete").delete(isAuthenticatedUser, deleteSeedsBulbsReview);

export default router;