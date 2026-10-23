import express from "express";
import {
  requestNurseryOnboarding,
  updateNurseryProfileDetails,
  getMyNurseryProfile,
  reviewNurseryApplication,
  getAllNurseryApplications,
  toggleNurseryStatus,
  getPublicVendorBySlug,
  getVendorProducts,
  getAdminVendorDetails,
  uploadNurseryDocuments,
  getAdminNurseryVerificationDetails,
  verifyNurseryDocuments,
  backfillNurserySlugs,
  getNurseryCommissionRates,
  updateNurseryCommission,
} from "../controllers/nurseryProfileController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";
import { validateNurseryDocumentsMiddleware } from "../middleware/nurseryDocumentUpload";

const router = express.Router();

// ======================================================================
// 👤 PUBLIC VENDOR ENDPOINTS
// ======================================================================
router.route(["/vendor/:slug", "/:slug"]).get(getPublicVendorBySlug);
router.route(["/vendor/:slug/products", "/:slug/products"]).get(getVendorProducts);

// ======================================================================
// 👤 USER OPEN ENDPOINT
// ======================================================================
router.route("/apply").post(isAuthenticatedUser, requestNurseryOnboarding);

// ======================================================================
// 📄 NURSERY DOCUMENT UPLOADS (KYC & ONBOARDING)
// ======================================================================
router
  .route(["/documents", "/upload-documents"])
  .post(
    isAuthenticatedUser,
    validateNurseryDocumentsMiddleware,
    uploadNurseryDocuments
  );

// ======================================================================
// 🏡 APPROVED NURSERY OWNER ENDPOINTS
// ======================================================================
router
  .route("/profile/me")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getMyNurseryProfile)
  .put(isAuthenticatedUser, authorizeRoles("nursery"), updateNurseryProfileDetails);

// ======================================================================
// 🛡️ SUPER ADMIN MANAGEMENT ENDPOINTS
// ======================================================================
router
  .route("/admin/applications")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAllNurseryApplications);

router
  .route("/admin/application/review/:id")
  .put(isAuthenticatedUser, authorizeRoles("admin"), reviewNurseryApplication);

router
  .route("/admin/nursery/toggle-status/:id")
  .put(isAuthenticatedUser, authorizeRoles("admin"), toggleNurseryStatus);

router
  .route("/admin/vendor/:id")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminVendorDetails);

// 🛡️ ADMIN NURSERY VERIFICATION FLOW
router
  .route("/admin/nurseries/:nurseryId")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminNurseryVerificationDetails);

router
  .route("/admin/nurseries/:nurseryId/verify-documents")
  .patch(isAuthenticatedUser, authorizeRoles("admin"), verifyNurseryDocuments)
  .put(isAuthenticatedUser, authorizeRoles("admin"), verifyNurseryDocuments);

// 🪙 ADMIN NURSERY COMMISSION OVERRIDES
router
  .route("/admin/nurseries/:nurseryId/commission")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getNurseryCommissionRates)
  .patch(isAuthenticatedUser, authorizeRoles("admin"), updateNurseryCommission)
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateNurseryCommission);

// 🛠️ Admin utility: backfill missing slugs on all nursery profiles
router
  .route("/admin/backfill-slugs")
  .post(isAuthenticatedUser, authorizeRoles("admin"), backfillNurserySlugs);

export default router;