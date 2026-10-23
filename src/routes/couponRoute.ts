import express from "express";
import { validateCoupon } from "../controllers/couponController";
import { isAuthenticatedUser } from "../middleware/auth";

const router = express.Router();

// Checkout page par jab click hoga tab ye API call hogi
router.route("/coupon/validate").post(isAuthenticatedUser, validateCoupon);

export default router;