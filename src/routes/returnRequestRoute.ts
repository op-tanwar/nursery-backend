import express from "express";
import {
  createReturnRequest,
  getAllReturnRequestsAdmin,
  updateReturnRequestStatusAdmin,
  getNurseryReturnRequests,
  getOrderReturnRequests,
} from "../controllers/returnRequestController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";

const router = express.Router();

// ======================================================================
// 👤 CUSTOMER ROUTES
// ======================================================================
router.route("/create").post(isAuthenticatedUser, createReturnRequest);
router.route("/order/:orderId").get(isAuthenticatedUser, getOrderReturnRequests);

// ======================================================================
// 🛡️ CENTRAL ADMIN ROUTES
// ======================================================================
router
  .route("/admin/all")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAllReturnRequestsAdmin);

router
  .route("/admin/:id/status")
  .patch(isAuthenticatedUser, authorizeRoles("admin"), updateReturnRequestStatusAdmin)
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateReturnRequestStatusAdmin);

// ======================================================================
// 🏡 NURSERY MERCHANT ROUTES (READ-ONLY ENFORCED)
// ======================================================================
router
  .route("/nursery/my-requests")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getNurseryReturnRequests);

export default router;
