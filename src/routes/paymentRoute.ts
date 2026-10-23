import express from "express";
import {
  createRazorpayOrder,
  verifyPayment,
  razorpayWebhook,
  cancelRazorpayOrder,
} from "../controllers/paymentController";
import { isAuthenticatedUser } from "../middleware/auth";

const router = express.Router();

router.route("/process").post(isAuthenticatedUser, createRazorpayOrder);
router.route("/create-order").post(isAuthenticatedUser, createRazorpayOrder);
router.route("/verify").post(isAuthenticatedUser, verifyPayment);
router.route("/cancel-order").post(isAuthenticatedUser, cancelRazorpayOrder);
router.route("/webhook").post(razorpayWebhook);

export default router;