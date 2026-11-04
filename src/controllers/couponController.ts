import { Request, Response, NextFunction } from "express";
import mongoose, { Types } from "mongoose";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import Coupon, { ICoupon } from "../models/couponModel";
import { roundMoney } from "../utils/pricingUtils";

// 🛡️ REUSABLE SERVER-SIDE AUTHORITATIVE COUPON VALIDATION ENGINE
export const verifyCouponInternal = async (
  code: string,
  cartTotal: number,
  userId?: string | Types.ObjectId,
  session?: any
): Promise<{
  coupon: ICoupon;
  discountAmount: number;
  couponCode: string;
  couponId: Types.ObjectId;
}> => {
  if (!code || typeof code !== "string" || !code.trim()) {
    throw new ErrorHandler("Coupon code is required", 400);
  }

  const cleanCode = code.trim().toUpperCase();
  const coupon = await Coupon.findOne({ code: cleanCode, isActive: true }).session(session || null);
  if (!coupon) {
    throw new ErrorHandler("Invalid or expired coupon code", 400);
  }

  if (new Date() > new Date(coupon.expiryDate)) {
    coupon.isActive = false;
    await coupon.save({ session: session || null });
    throw new ErrorHandler("This coupon has expired", 400);
  }

  // 🛡️ Global usage limit verification
  if (typeof coupon.usageLimit === "number" && coupon.usageLimit > 0) {
    const currentUsage = Number(coupon.usedCount || coupon.usedBy?.length || 0);
    if (currentUsage >= coupon.usageLimit) {
      throw new ErrorHandler("This coupon has reached its maximum redemption limit.", 400);
    }
  }

  // 🛡️ Per-user single redemption enforcement
  if (userId && coupon.usedBy && coupon.usedBy.length > 0) {
    const userStr = userId.toString();
    const alreadyRedeemed = coupon.usedBy.some((id: any) => id?.toString() === userStr);
    if (alreadyRedeemed) {
      throw new ErrorHandler("You have already redeemed this coupon code once.", 400);
    }
  }

  // 🛡️ Minimum cart value verification
  if (cartTotal < (coupon.minCartValue || 0)) {
    throw new ErrorHandler(
      `Minimum cart value must be ₹${coupon.minCartValue} to use coupon "${coupon.code}".`,
      400
    );
  }

  let calculatedDiscount = 0;
  if (coupon.discountType === "percentage") {
    calculatedDiscount = (cartTotal * coupon.discountValue) / 100;
    if (typeof coupon.maxDiscountAmount === "number" && coupon.maxDiscountAmount > 0) {
      calculatedDiscount = Math.min(calculatedDiscount, coupon.maxDiscountAmount);
    }
  } else {
    calculatedDiscount = coupon.discountValue;
  }

  const finalDiscount = roundMoney(Math.min(calculatedDiscount, cartTotal));

  return {
    coupon,
    discountAmount: finalDiscount,
    couponCode: coupon.code,
    couponId: coupon._id as Types.ObjectId,
  };
};

// ======================================================================
// 🎫 VALIDATE COUPON CODE DURING CHECKOUT (FRONTEND HANDSHAKE API)
// ======================================================================
export const validateCoupon = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    const { code, cartTotal } = req.body;
    const userId = req.user?._id;

    if (!code || cartTotal === undefined || cartTotal === null) {
      return next(new ErrorHandler("Coupon code and cart total are required.", 400));
    }

    const numericTotal = Number(cartTotal);
    if (isNaN(numericTotal) || numericTotal < 0) {
      return next(new ErrorHandler("Invalid cart total provided.", 400));
    }

    try {
      const { coupon, discountAmount } = await verifyCouponInternal(code, numericTotal, userId);

      res.status(200).json({
        success: true,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discountAmount,
        finalTotal: Math.max(0, roundMoney(numericTotal - discountAmount)),
        message: `Coupon "${coupon.code}" applied! You saved ₹${discountAmount}.`,
      });
    } catch (error: any) {
      return next(error);
    }
  }
);