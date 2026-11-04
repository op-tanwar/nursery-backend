import express from "express";
import {
  createRazorpayOrder,
  verifyPayment,
  razorpayWebhook,
  cancelRazorpayOrder,
} from "../controllers/paymentController";
import { isAuthenticatedUser, optionalAuthenticateUser } from "../middleware/auth";

const router = express.Router();

router.route("/process").post(isAuthenticatedUser, createRazorpayOrder);
router.route("/create-order").post(isAuthenticatedUser, createRazorpayOrder);
router.route("/verify").post(isAuthenticatedUser, verifyPayment);
router.route("/cancel-order").post(optionalAuthenticateUser, cancelRazorpayOrder);
router.route("/webhook").post(razorpayWebhook);

export default router;