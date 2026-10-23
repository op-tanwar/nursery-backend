import express from "express";
import {
  createNewOrder,
  getSingleOrder,
  myOrders,
  getAllOrders,
  getMyNurseryOrders,
  updateOrderAdmin,
  updateOrderNursery,
  deleteOrder,
  requestItemClaim,
} from "../controllers/orderController";
import {
  getNurseryDashboardStats,
  getAdminDashboardStats,
} from "../controllers/dashboardController";
import { isAuthenticatedUser, optionalAuthenticateUser, authorizeRoles } from "../middleware/auth";
import { validateUploadedFiles } from "../middleware/fileValidate"; // 🛡️ Imported validation middleware factory

const router = express.Router();

// ======================================================================
// 👤 USER ACCESSIBLE SECTORS
// ======================================================================
router.route("/new").post(isAuthenticatedUser, createNewOrder);
router.route("/").post(isAuthenticatedUser, createNewOrder);
router.route("/me").get(isAuthenticatedUser, myOrders);
router.route("/single/:id").get(optionalAuthenticateUser, getSingleOrder);
router.route("/detail/:id").get(optionalAuthenticateUser, getSingleOrder);
router.route("/:id").get(optionalAuthenticateUser, getSingleOrder);
router.route("/nursery/single/:id").get(isAuthenticatedUser, authorizeRoles("nursery"), getSingleOrder);
router.route("/admin/single/:id").get(isAuthenticatedUser, authorizeRoles("admin"), getSingleOrder);

// 🎬 ROUTE-SCOPED OVERRIDE: Permits validated video unboxing attachments strictly for claims context
router.route("/claim/new").post(
  isAuthenticatedUser, 
  validateUploadedFiles({ allowVideo: true }), 
  requestItemClaim
);

// ======================================================================
// 🏡 NURSERY / VENDOR ACCESSIBLE SECTORS
// ======================================================================
router.route("/nursery/dashboard-stats").get(
  isAuthenticatedUser, 
  authorizeRoles("nursery"), 
  getNurseryDashboardStats
);

router.route("/nursery/all").get(
  isAuthenticatedUser, 
  authorizeRoles("nursery"), 
  getMyNurseryOrders
);

router.route("/nursery/update-status/:id").put(
  isAuthenticatedUser, 
  authorizeRoles("nursery"), 
  updateOrderNursery
);

// ======================================================================
// 🛡️ ADMIN PRIVILEGED SECTORS
// ======================================================================
router.route("/admin/dashboard-stats").get(
  isAuthenticatedUser, 
  authorizeRoles("admin"), 
  getAdminDashboardStats
);

router.route("/admin/all").get(
  isAuthenticatedUser, 
  authorizeRoles("admin"), 
  getAllOrders
);

router.route("/admin/manage/:id")
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateOrderAdmin)
  .delete(isAuthenticatedUser, authorizeRoles("admin"), deleteOrder);

export default router;