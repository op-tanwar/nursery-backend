import express from "express";
import {
  getAdminNurseryVerificationDetails,
  verifyNurseryDocuments,
  getAllNurseryApplications,
  reviewNurseryApplication,
  toggleNurseryStatus,
  getAdminVendorDetails,
  manageNurseryServicePincodes,
} from "../controllers/nurseryProfileController";
import {
  getAllBulkOrders,
  getBulkOrderDetails,
  updateBulkOrderStatus,
  deleteBulkOrder,
} from "../controllers/bulkOrderController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";

const router = express.Router();

// ======================================================================
// 📦 ADMIN BULK ORDERS MANAGEMENT (`/api/v1/admin/bulk-orders`)
// ======================================================================
router
  .route("/bulk-orders")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAllBulkOrders);

router
  .route("/bulk-orders/:id/status")
  .patch(isAuthenticatedUser, authorizeRoles("admin"), updateBulkOrderStatus)
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateBulkOrderStatus);

router
  .route("/bulk-orders/:id")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getBulkOrderDetails)
  .delete(isAuthenticatedUser, authorizeRoles("admin"), deleteBulkOrder);

// ======================================================================
// 🛡️ ADMIN NURSERY VERIFICATION FLOW (`/api/v1/admin/nurseries/:nurseryId`)
// ======================================================================
router
  .route("/nurseries/:nurseryId")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminNurseryVerificationDetails);

router
  .route("/nurseries/:nurseryId/verify-documents")
  .patch(isAuthenticatedUser, authorizeRoles("admin"), verifyNurseryDocuments)
  .put(isAuthenticatedUser, authorizeRoles("admin"), verifyNurseryDocuments);

// ======================================================================
// 🛡️ ADMIN SERVICE PINCODE MANAGEMENT (`/api/v1/admin/nurseries/:nurseryId/pincodes`)
// ======================================================================
router
  .route("/nurseries/:nurseryId/pincodes")
  .patch(isAuthenticatedUser, authorizeRoles("admin"), manageNurseryServicePincodes);

// ======================================================================
// 🛡️ ADMIN NURSERY ONBOARDING & STATUS MANAGEMENT
// ======================================================================
router
  .route(["/nurseries", "/applications"])
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAllNurseryApplications);

router
  .route("/application/review/:id")
  .put(isAuthenticatedUser, authorizeRoles("admin"), reviewNurseryApplication);

router
  .route("/nursery/toggle-status/:id")
  .put(isAuthenticatedUser, authorizeRoles("admin"), toggleNurseryStatus);

router
  .route("/vendor/:id")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminVendorDetails);

export default router;
