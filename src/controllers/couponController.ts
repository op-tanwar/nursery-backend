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

// ======================================================================
// 🎟️ ADMIN: GET ALL COUPONS WITH SEARCH, FILTERS & KPI METRICS
// GET /api/v1/coupons
// ======================================================================
export const getAllCoupons = catchAsyncErrors(
  async (req: Request, res: Response, _next: NextFunction) => {
    const { search, status, discountType, page = 1, limit = 50 } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const now = new Date();
    const filter: any = {};

    // 1. Search by Coupon Code
    if (search && typeof search === "string" && search.trim()) {
      filter.code = { $regex: search.trim().toUpperCase(), $options: "i" };
    }

    // 2. Filter by Status
    if (status && typeof status === "string") {
      const s = status.toLowerCase().trim();
      if (s === "active") {
        filter.isActive = true;
        filter.expiryDate = { $gt: now };
      } else if (s === "expired") {
        filter.expiryDate = { $lte: now };
      } else if (s === "inactive" || s === "draft") {
        filter.isActive = false;
      }
    }

    // 3. Filter by Discount Type
    if (discountType && typeof discountType === "string") {
      const dt = discountType.toLowerCase().trim();
      if (dt === "percentage" || dt === "flat") {
        filter.discountType = dt;
      }
    }

    const [coupons, totalMatching, totalCoupons, activeCoupons, expiredCoupons, redemptionAggregate] =
      await Promise.all([
        Coupon.find(filter)
          .sort("-createdAt")
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Coupon.countDocuments(filter),
        Coupon.countDocuments(),
        Coupon.countDocuments({ isActive: true, expiryDate: { $gt: now } }),
        Coupon.countDocuments({ expiryDate: { $lte: now } }),
        Coupon.aggregate([{ $group: { _id: null, total: { $sum: "$usedCount" } } }]),
      ]);

    const totalRedemptions = redemptionAggregate?.[0]?.total || 0;

    res.status(200).json({
      success: true,
      count: totalMatching,
      totalPages: Math.ceil(totalMatching / limitNum) || 1,
      currentPage: pageNum,
      stats: {
        totalCoupons,
        activeCoupons,
        expiredCoupons,
        totalRedemptions,
      },
      coupons,
    });
  }
);

// ======================================================================
// 🎟️ ADMIN: GET SINGLE COUPON DETAILS
// GET /api/v1/coupons/:id
// ======================================================================
export const getCouponDetails = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new ErrorHandler("Invalid coupon ID provided.", 400));
    }

    const coupon = await Coupon.findById(id).lean();
    if (!coupon) {
      return next(new ErrorHandler("Coupon not found.", 404));
    }

    res.status(200).json({
      success: true,
      coupon,
    });
  }
);

// ======================================================================
// 🎟️ ADMIN: CREATE NEW PROMOTIONAL COUPON
// POST /api/v1/coupons
// ======================================================================
export const createCoupon = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      code,
      discountType,
      discountValue,
      minOrderValue,
      minCartValue,
      maxDiscountAmount,
      usageLimit,
      startDate,
      endDate,
      expiryDate,
      isActive = true,
    } = req.body;

    if (!code || typeof code !== "string" || !code.trim()) {
      return next(new ErrorHandler("Coupon code is required.", 400));
    }

    const cleanCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(cleanCode)) {
      return next(
        new ErrorHandler(
          "Coupon code must be between 3 and 20 uppercase alphanumeric characters (hyphens and underscores allowed).",
          400
        )
      );
    }

    // Check code uniqueness
    const existing = await Coupon.findOne({ code: cleanCode });
    if (existing) {
      return next(new ErrorHandler(`Coupon code "${cleanCode}" already exists.`, 400));
    }

    const rawType = String(discountType || "").toLowerCase().trim();
    if (rawType !== "percentage" && rawType !== "flat") {
      return next(new ErrorHandler("Discount type must be either 'percentage' or 'flat'.", 400));
    }

    const numValue = Number(discountValue);
    if (isNaN(numValue) || numValue <= 0) {
      return next(new ErrorHandler("Discount value must be a positive number.", 400));
    }

    if (rawType === "percentage" && numValue > 100) {
      return next(new ErrorHandler("Percentage discount cannot exceed 100%.", 400));
    }

    const finalMinOrder = Math.max(0, Number(minOrderValue ?? minCartValue ?? 0) || 0);

    const finalExpiry = endDate || expiryDate;
    if (!finalExpiry) {
      return next(new ErrorHandler("Coupon expiry date is required.", 400));
    }

    const parsedExpiry = new Date(finalExpiry);
    if (isNaN(parsedExpiry.getTime())) {
      return next(new ErrorHandler("Invalid expiry date format.", 400));
    }

    const parsedStart = startDate ? new Date(startDate) : new Date();
    if (parsedExpiry <= parsedStart) {
      return next(new ErrorHandler("Expiry date must be after the start date.", 400));
    }

    let parsedMaxDiscount: number | undefined = undefined;
    if (rawType === "percentage" && maxDiscountAmount !== undefined && maxDiscountAmount !== null && maxDiscountAmount !== "") {
      const numMax = Number(maxDiscountAmount);
      if (isNaN(numMax) || numMax <= 0) {
        return next(new ErrorHandler("Max discount amount must be a positive number.", 400));
      }
      parsedMaxDiscount = numMax;
    }

    let parsedUsageLimit: number | undefined = undefined;
    if (usageLimit !== undefined && usageLimit !== null && usageLimit !== "") {
      const numLimit = Number(usageLimit);
      if (isNaN(numLimit) || numLimit <= 0) {
        return next(new ErrorHandler("Usage limit must be a positive integer.", 400));
      }
      parsedUsageLimit = Math.floor(numLimit);
    }

    const coupon = await Coupon.create({
      code: cleanCode,
      discountType: rawType,
      discountValue: numValue,
      minCartValue: finalMinOrder,
      maxDiscountAmount: parsedMaxDiscount,
      usageLimit: parsedUsageLimit,
      startDate: parsedStart,
      expiryDate: parsedExpiry,
      isActive: Boolean(isActive),
    });

    res.status(201).json({
      success: true,
      coupon,
      message: `Coupon "${coupon.code}" created successfully.`,
    });
  }
);

// ======================================================================
// 🎟️ ADMIN: UPDATE EXISTING COUPON
// PUT/PATCH /api/v1/coupons/:id
// ======================================================================
export const updateCoupon = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new ErrorHandler("Invalid coupon ID.", 400));
    }

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return next(new ErrorHandler("Coupon not found.", 404));
    }

    const {
      code,
      discountType,
      discountValue,
      minOrderValue,
      minCartValue,
      maxDiscountAmount,
      usageLimit,
      startDate,
      endDate,
      expiryDate,
      isActive,
    } = req.body;

    // 1. Code update validation
    if (code && typeof code === "string" && code.trim()) {
      const cleanCode = code.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{3,20}$/.test(cleanCode)) {
        return next(
          new ErrorHandler(
            "Coupon code must be between 3 and 20 uppercase alphanumeric characters.",
            400
          )
        );
      }
      if (cleanCode !== coupon.code) {
        const existing = await Coupon.findOne({ code: cleanCode, _id: { $ne: coupon._id } });
        if (existing) {
          return next(new ErrorHandler(`Coupon code "${cleanCode}" is already in use.`, 400));
        }
        coupon.code = cleanCode;
      }
    }

    // 2. Discount Type & Value
    if (discountType !== undefined) {
      const rawType = String(discountType).toLowerCase().trim();
      if (rawType !== "percentage" && rawType !== "flat") {
        return next(new ErrorHandler("Discount type must be either 'percentage' or 'flat'.", 400));
      }
      coupon.discountType = rawType as "percentage" | "flat";
    }

    if (discountValue !== undefined) {
      const numVal = Number(discountValue);
      if (isNaN(numVal) || numVal <= 0) {
        return next(new ErrorHandler("Discount value must be a positive number.", 400));
      }
      if (coupon.discountType === "percentage" && numVal > 100) {
        return next(new ErrorHandler("Percentage discount cannot exceed 100%.", 400));
      }
      coupon.discountValue = numVal;
    }

    // 3. Minimum Cart / Order Value
    if (minOrderValue !== undefined || minCartValue !== undefined) {
      const finalMin = Math.max(0, Number(minOrderValue ?? minCartValue ?? 0) || 0);
      coupon.minCartValue = finalMin;
    }

    // 4. Max Discount
    if (maxDiscountAmount !== undefined) {
      if (maxDiscountAmount === null || maxDiscountAmount === "") {
        coupon.maxDiscountAmount = undefined;
      } else {
        const numMax = Number(maxDiscountAmount);
        if (isNaN(numMax) || numMax <= 0) {
          return next(new ErrorHandler("Max discount amount must be positive.", 400));
        }
        coupon.maxDiscountAmount = numMax;
      }
    }

    // 5. Usage Limit
    if (usageLimit !== undefined) {
      if (usageLimit === null || usageLimit === "") {
        coupon.usageLimit = undefined;
      } else {
        const numLimit = Number(usageLimit);
        if (isNaN(numLimit) || numLimit <= 0) {
          return next(new ErrorHandler("Usage limit must be a positive integer.", 400));
        }
        coupon.usageLimit = Math.floor(numLimit);
      }
    }

    // 6. Dates
    if (startDate) {
      const parsedStart = new Date(startDate);
      if (isNaN(parsedStart.getTime())) {
        return next(new ErrorHandler("Invalid start date.", 400));
      }
      coupon.startDate = parsedStart;
    }

    const finalExpiry = endDate || expiryDate;
    if (finalExpiry) {
      const parsedExpiry = new Date(finalExpiry);
      if (isNaN(parsedExpiry.getTime())) {
        return next(new ErrorHandler("Invalid expiry date.", 400));
      }
      if (coupon.startDate && parsedExpiry <= coupon.startDate) {
        return next(new ErrorHandler("Expiry date must be after the start date.", 400));
      }
      coupon.expiryDate = parsedExpiry;
    }

    // 7. Active status
    if (isActive !== undefined) {
      coupon.isActive = Boolean(isActive);
    }

    await coupon.save();

    res.status(200).json({
      success: true,
      coupon,
      message: `Coupon "${coupon.code}" updated successfully.`,
    });
  }
);

// ======================================================================
// 🎟️ ADMIN: TOGGLE COUPON ACTIVE STATUS
// PATCH /api/v1/coupons/:id/toggle-status
// ======================================================================
export const toggleCouponStatus = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new ErrorHandler("Invalid coupon ID.", 400));
    }

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return next(new ErrorHandler("Coupon not found.", 404));
    }

    if (typeof req.body.isActive === "boolean") {
      coupon.isActive = req.body.isActive;
    } else {
      coupon.isActive = !coupon.isActive;
    }

    await coupon.save();

    res.status(200).json({
      success: true,
      coupon,
      message: `Coupon "${coupon.code}" is now ${coupon.isActive ? "active" : "inactive"}.`,
    });
  }
);

// ======================================================================
// 🎟️ ADMIN: DELETE COUPON
// DELETE /api/v1/coupons/:id
// ======================================================================
export const deleteCoupon = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new ErrorHandler("Invalid coupon ID.", 400));
    }

    const coupon = await Coupon.findByIdAndDelete(id);
    if (!coupon) {
      return next(new ErrorHandler("Coupon not found.", 404));
    }

    res.status(200).json({
      success: true,
      message: `Coupon "${coupon.code}" deleted successfully.`,
    });
  }
);
