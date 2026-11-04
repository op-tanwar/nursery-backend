import express from "express";
import {
  createClaimRequest,
  getAllClaimsAdmin,
  updateClaimStatus,
  getClaimsByNursery,
  getClaimsByUser,
  getClaimById,
} from "../controllers/returnClaimController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";
import { validateUploadedFiles } from "../middleware/fileValidate";

const router = express.Router();

// ======================================================================
// 👤 CUSTOMER CLAIM / RETURN / REPLACEMENT ROUTES
// ======================================================================
router
  .route("/")
  .post(
    isAuthenticatedUser,
    validateUploadedFiles({ allowVideo: true }),
    createClaimRequest
  )
  .get(isAuthenticatedUser, getClaimsByUser);

router
  .route("/create")
  .post(
    isAuthenticatedUser,
    validateUploadedFiles({ allowVideo: true }),
    createClaimRequest
  );

router.route("/me").get(isAuthenticatedUser, getClaimsByUser);
router.route("/order/:orderId").get(isAuthenticatedUser, getClaimsByUser);

// ======================================================================
// 🛡️ CENTRAL ADMIN AUDIT & LIFECYCLE MANAGEMENT ROUTES
// ======================================================================
router
  .route("/admin/all")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAllClaimsAdmin);

router
  .route("/admin/:id/status")
  .patch(isAuthenticatedUser, authorizeRoles("admin"), updateClaimStatus)
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateClaimStatus);

// ======================================================================
// 🏡 NURSERY MERCHANT VENDOR ROUTES
// ======================================================================
router
  .route("/nursery/my-requests")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getClaimsByNursery);

router
  .route("/nursery/requests")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getClaimsByNursery);

// ======================================================================
// 🔍 SINGLE CLAIM DETAILS ROUTE
// ======================================================================
router.route("/single/:id").get(isAuthenticatedUser, getClaimById);
router.route("/:id").get(isAuthenticatedUser, getClaimById);

export default router;
