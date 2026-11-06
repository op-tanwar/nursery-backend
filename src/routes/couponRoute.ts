import express from "express";
import {
  validateCoupon,
  getAllCoupons,
  getCouponDetails,
  createCoupon,
  updateCoupon,
  toggleCouponStatus,
  deleteCoupon,
} from "../controllers/couponController";
import {
  isAuthenticatedUser,
  authorizeRoles,
  optionalAuthenticateUser,
} from "../middleware/auth";

const router = express.Router();

// 🎟️ 1. Checkout Validation Endpoints (Public / Authenticated Handshake)
router.route("/validate").post(optionalAuthenticateUser, validateCoupon);
router.route("/coupon/validate").post(optionalAuthenticateUser, validateCoupon);

// 🎟️ 2. Core Coupon Collection (Admin Management + Root Checkout Fallback)
router
  .route("/")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAllCoupons)
  .post(optionalAuthenticateUser, (req, res, next) => {
    // If request has cartTotal but no discountType, dispatch to checkout coupon validation
    if (req.body.cartTotal !== undefined && req.body.discountType === undefined) {
      return validateCoupon(req, res, next);
    }
    // Otherwise, enforce admin authorization and dispatch to coupon creation
    return (isAuthenticatedUser as any)(req, res, () => {
      return (authorizeRoles("admin") as any)(req, res, () => {
        return createCoupon(req, res, next);
      });
    });
  });

// 🎟️ 3. Single Coupon Resource Endpoints
router
  .route("/:id")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getCouponDetails)
  .put(isAuthenticatedUser, authorizeRoles("admin"), updateCoupon)
  .patch(isAuthenticatedUser, authorizeRoles("admin"), updateCoupon)
  .delete(isAuthenticatedUser, authorizeRoles("admin"), deleteCoupon);

// 🎟️ 4. Status Toggling Aliases
router
  .route("/:id/toggle-status")
  .patch(isAuthenticatedUser, authorizeRoles("admin"), toggleCouponStatus)
  .put(isAuthenticatedUser, authorizeRoles("admin"), toggleCouponStatus);

router
  .route("/:id/status")
  .patch(isAuthenticatedUser, authorizeRoles("admin"), toggleCouponStatus);

export default router;
