import express from "express";
import {
  uploadNurseryDocuments,
  getMyNurseryProfile,
  updateNurseryProfileDetails,
  requestNurseryOnboarding,
  getPublicVendorBySlug,
  getVendorProducts,
} from "../controllers/nurseryProfileController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";
import { validateNurseryDocumentsMiddleware } from "../middleware/nurseryDocumentUpload";

const router = express.Router();

// ======================================================================
// 📄 NURSERY DOCUMENT UPLOADS (`POST /api/v1/nursery/documents` & `/upload-documents`)
// ======================================================================
router
  .route(["/documents", "/upload-documents"])
  .post(
    isAuthenticatedUser,
    validateNurseryDocumentsMiddleware,
    uploadNurseryDocuments
  );

// ======================================================================
// 🏡 NURSERY PROFILE ENDPOINTS
// ======================================================================
router.route("/apply").post(isAuthenticatedUser, requestNurseryOnboarding);

router
  .route(["/profile/me", "/me"])
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getMyNurseryProfile)
  .put(isAuthenticatedUser, authorizeRoles("nursery"), updateNurseryProfileDetails);

router.route(["/vendor/:slug", "/:slug"]).get(getPublicVendorBySlug);
router.route(["/vendor/:slug/products", "/:slug/products"]).get(getVendorProducts);

export default router;
