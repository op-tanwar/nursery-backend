import express from "express";
import {
  createBulkOrder,
  createBulkOrderInquiry,
  getAllBulkOrders,
  getBulkOrderDetails,
  updateBulkOrderStatus,
  deleteBulkOrder,
} from "../controllers/bulkOrderController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";

const router = express.Router();

// ======================================================================
// 🌍 PUBLIC INQUIRY SUBMISSION ENDPOINT (`/api/bulk-orders` & `/api/bulk-orders/inquiry`)
// ======================================================================
router.route("/").post(createBulkOrder);
router.route("/inquiry").post(createBulkOrderInquiry);

// ======================================================================
// 🛡️ ADMIN MANAGEMENT ENDPOINTS (`/api/bulk-orders/...`)
// ======================================================================
router
  .route("/")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAllBulkOrders);

router
  .route("/admin/orders")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAllBulkOrders);

router
  .route("/:id")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getBulkOrderDetails)
  .delete(isAuthenticatedUser, authorizeRoles("admin"), deleteBulkOrder);

router
  .route("/:id/status")
  .patch(isAuthenticatedUser, authorizeRoles("admin"), updateBulkOrderStatus)
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateBulkOrderStatus);

router
  .route("/admin/order/:id")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getBulkOrderDetails)
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateBulkOrderStatus)
  .patch(isAuthenticatedUser, authorizeRoles("admin"), updateBulkOrderStatus)
  .delete(isAuthenticatedUser, authorizeRoles("admin"), deleteBulkOrder);

export default router;