import { Request, Response, NextFunction } from "express";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import Coupon from "../models/couponModel";

// 🛡️ REUSABLE SERVER-SIDE AUTHORITATIVE COUPON VALIDATION ENGINE
export const verifyCouponInternal = async (code: string, cartTotal: number, userId: string, session?: any) => {
  const coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true }).session(session);
  if (!coupon) throw new ErrorHandler("Invalid or expired coupon code", 400);

  if (new Date() > coupon.expiryDate) {
    coupon.isActive = false;
    await coupon.save({ session });
    throw new ErrorHandler("This coupon has expired", 400);
  }

  // 🛡️ FIXED: Vulnerability — Stop unlimited account-wide reuse
  if (coupon.usedBy && coupon.usedBy.map(id => id.toString()).includes(userId.toString())) {
    throw new ErrorHandler("You have already redeemed this coupon code once.", 400);
  }

  if (cartTotal < coupon.minCartValue) {
    throw new ErrorHandler(`Minimum cart value must be ₹${coupon.minCartValue} to use this coupon`, 400);
  }

  let discountAmount = 0;
  if (coupon.discountType === "percentage") {
    discountAmount = (cartTotal * coupon.discountValue) / 100;
  } else {
    discountAmount = coupon.discountValue;
  }

  if (discountAmount > cartTotal) {
    discountAmount = cartTotal;
  }

  return { discountAmount, couponId: coupon._id };
};

// ======================================================================
// 🎫 VALIDATE COUPON CODE DURING CHECKOUT (FRONTEND HANDSHAKE API)
// ======================================================================
export const validateCoupon = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    const { code, cartTotal } = req.body;
    const userId = req.user?._id;

    if (!code || !cartTotal) {
      return next(new ErrorHandler("Coupon code and cart total are required", 400));
    }

    try {
      const { discountAmount } = await verifyCouponInternal(code, Number(cartTotal), userId);

      res.status(200).json({
        success: true,
        discountAmount,
        finalTotal: Number(cartTotal) - discountAmount,
      });
    } catch (error: any) {
      return next(error);
    }
  }
);