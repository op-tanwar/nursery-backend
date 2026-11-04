import express from "express";
import { validateCoupon } from "../controllers/couponController";
import { isAuthenticatedUser } from "../middleware/auth";

const router = express.Router();

// Support both /coupon/validate and /validate
router.route("/coupon/validate").post(isAuthenticatedUser, validateCoupon);
router.route("/validate").post(isAuthenticatedUser, validateCoupon);

export default router;