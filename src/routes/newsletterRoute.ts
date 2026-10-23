import express from "express";
import {
  subscribeNewsletter,
  unsubscribeNewsletter,
  getAllSubscribers,
  deleteSubscriber,
  toggleSubscriberStatus,
} from "../controllers/newsletterController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";

const router = express.Router();

// ======================================================================
// 🌍 PUBLIC NEWSLETTER ENDPOINTS
// ======================================================================
// 1. Subscribe to newsletter
router.post("/subscribe", subscribeNewsletter);

// 2. Unsubscribe from newsletter (supports POST body or GET one-click link)
router.post("/unsubscribe", unsubscribeNewsletter);
router.get("/unsubscribe", unsubscribeNewsletter);

// ======================================================================
// 🛡️ PROTECTED ADMIN DASHBOARD ENDPOINTS
// ======================================================================
// 3. Fetch subscribers with pagination, search, status filter, and CSV export
router.get(
  "/subscribers",
  isAuthenticatedUser,
  authorizeRoles("admin"),
  getAllSubscribers
);
router.get(
  "/admin/subscribers",
  isAuthenticatedUser,
  authorizeRoles("admin"),
  getAllSubscribers
);

// 4. Delete subscriber by ID
router.delete(
  "/subscribers/:id",
  isAuthenticatedUser,
  authorizeRoles("admin"),
  deleteSubscriber
);
router.delete(
  "/admin/subscribers/:id",
  isAuthenticatedUser,
  authorizeRoles("admin"),
  deleteSubscriber
);

// 5. Update/Toggle status (active/unsubscribed)
router.patch(
  "/subscribers/:id",
  isAuthenticatedUser,
  authorizeRoles("admin"),
  toggleSubscriberStatus
);
router.patch(
  "/admin/subscribers/:id",
  isAuthenticatedUser,
  authorizeRoles("admin"),
  toggleSubscriberStatus
);

export default router;