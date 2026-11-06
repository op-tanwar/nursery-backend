import express from "express";
import {
  getAdminGlobalReviews,
  updateReviewStatus,
  deleteAdminReview,
  bulkUpdateReviewStatus,
} from "../controllers/adminReviewController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";

export const adminReviewRouter = express.Router();

// 🛡️ Admin global reviews queue, filters & KPIs
adminReviewRouter
  .route("/")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminGlobalReviews);

// ⚡ Admin bulk review moderation
adminReviewRouter
  .route("/bulk-status")
  .patch(isAuthenticatedUser, authorizeRoles("admin"), bulkUpdateReviewStatus);

// 🛡️ Admin single review status mutation
adminReviewRouter
  .route("/:id/status")
  .patch(isAuthenticatedUser, authorizeRoles("admin"), updateReviewStatus)
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateReviewStatus);

// 🗑️ Admin single review permanent purge
adminReviewRouter
  .route("/:id")
  .delete(isAuthenticatedUser, authorizeRoles("admin"), deleteAdminReview);

const reviewRouter = express.Router();

// Public / general review routing delegation
reviewRouter.use("/admin", adminReviewRouter);
reviewRouter.use("/", adminReviewRouter);

export default reviewRouter;
