import express from "express";
import {
  createArtificial,
  getAllArtificials,
  getArtificialDetails,
  getArtificialBySlug,
  updateArtificial,
  deleteArtificial,
  toggleArtificialStatus,
  createArtificialReview,
  getArtificialReviews,
  deleteArtificialReview,
  getNurseryArtificials,
  getAdminAllArtificials,
} from "../controllers/artificialDriedPlantController";

import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";
import { validateProductBody, artificialDriedPlantValidationSchema } from "../validations/productValidation";

const router = express.Router();

// ======================================================================
// 🌐 1️⃣ PUBLIC ROUTES 
// ======================================================================

router.route("/allArtificials").get(getAllArtificials);
router.route("/artificial/slug/:slug").get(getArtificialBySlug);
router.route("/artificial/:id").get(getArtificialDetails);
router.route("/artificial/reviews").get(getArtificialReviews);

// ======================================================================
// 🏡 2️⃣ NURSERY VENDOR ROUTES 
// ======================================================================

router
  .route("/admin/artificial/new")
  .post(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(artificialDriedPlantValidationSchema, "artificialData"), createArtificial);

router
  .route("/admin/artificial/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery"), validateProductBody(artificialDriedPlantValidationSchema, "artificialData"), updateArtificial)
  .delete(isAuthenticatedUser, authorizeRoles("nursery", "admin"), deleteArtificial);

router
  .route("/admin/artificial/toggle/:id")
  .put(isAuthenticatedUser, authorizeRoles("nursery", "admin"), toggleArtificialStatus);

router
  .route("/admin/my-artificials")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getNurseryArtificials);

router
  .route("/admin/all-artificials")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminAllArtificials);

// ======================================================================
// 🛍️ 3️⃣ CUSTOMER / USER ROUTES 
// ======================================================================

router.route("/artificial/review").put(isAuthenticatedUser, createArtificialReview);
router.route("/artificial/review/delete").delete(isAuthenticatedUser, deleteArtificialReview);

export default router;