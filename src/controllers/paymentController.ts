import { Request, Response, NextFunction } from "express";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import Order from "../models/orderModel";
import TransactionLedger from "../models/transactionLedgerModel";
import StockReservation from "../models/stockReservationModel";
import { getRazorpayInstance } from "../services/razorpay";
import {
  reserveStockForItems,
  rollbackLockedItems,
  createStockReservationRecord,
  commitStockReservation,
  releaseStockReservation,
} from "../services/stockReservationService";
import { processFallbackRefund } from "../services/fallbackRefundService";
import Razorpay from "razorpay";
import * as crypto from "node:crypto";
import mongoose from "mongoose";
import {
  sendOrderConfirmationEmail,
  sendNurseryOrderAlertEmail,
  sendAdminNewOrderEmail,
} from "../utils/orderEmailService";
import sendEmail from "../utils/sendEmail";
import { getPaymentFailedHtml, sendLowStockAlert } from "../templates/emails";
import {
  getCaseInsensitiveModel,
  resolveProductAndModel,
} from "../utils/productRegistry";
import {
  getEffectivePrice,
  calculateAuthoritativeTotals,
  calculateServerShippingAndTax,
  toPaise,
  toRupees,
} from "../utils/pricingUtils";
import {
  getCommissionRate,
  calcLineGross,
  calcLineCommission,
  roundMoney,
} from "../utils/financialUtils";
import { withTransaction } from "../utils/transactionHelper";
import { getActiveTaxMap } from "../utils/taxService";
import { getEffectiveCommission } from "../utils/commissionService";
import User from "../models/userModel";
import NurseryProfile from "../models/nurseryProfileModel";
import Coupon from "../models/couponModel";
import { verifyCouponInternal } from "./couponController";
import { checkCartAvailability } from "./cartController";
import {
  checkCartItemsPincodeServiceability,
  isPincodeServiceable,
} from "../utils/pincodeService";
import {
  processOrderPlacement,
  OrderPlacementService,
} from "../services/orderPlacementService";

interface AuthenticatedRequest extends Request {
  rawBody?: string;
}

// Re-export getRazorpayInstance for backwards-compatibility
export { getRazorpayInstance };

// ======================================================================
// 💳 1. CREATE RAZORPAY ORDER (SECURED WITH VALUE VERIFICATION & DYNAMIC TAX)
// ======================================================================
export const createRazorpayOrder = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    const { orderItems, couponCode, coupon, shippingInfo } = req.body;

    if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
      return next(new ErrorHandler("Order items validation sequence mapping failed. Items array required.", 400));
    }

    // 🛡️ CHECKOUT GUARD: Ensure customer's cart does not contain unavailable items
    if (req.user?._id) {
      const cartCheck = await checkCartAvailability(req.user._id);
      if (!cartCheck.isValid) {
        const itemNames = cartCheck.unavailableItems.map((u) => `"${u.name}"`).join(", ");
        return next(
          new ErrorHandler(
            `Your cart contains unavailable item(s): ${itemNames}. Please remove or save these items for later before placing an order.`,
            400
          )
        );
      }
    }

    const taxMap = await getActiveTaxMap();

    // 🔒 1. SERVER-SIDE PRICE COMPUTATION & STOCK VALIDATION DIRECTLY FROM DATABASE
    const authoritativeItems: Array<{
      product: any;
      modelName: string;
      itemModel: string;
      category?: string;
      quantity: number;
      price: number;
      discountPrice?: number;
      effectivePrice: number;
    }> = [];

    for (const item of orderItems) {
      const targetId = item.productId || item.item || item.id || item._id;
      if (!targetId) {
        return next(new ErrorHandler("Product ID reference missing on order item.", 400));
      }

      const quantity = Math.max(1, Number(item.quantity) || 1);
      const { product: dbProduct, modelName } = await resolveProductAndModel(
        String(targetId),
        item.itemModel
      );

      if (!dbProduct || !modelName) {
        return next(new ErrorHandler(`Product mismatch error context for ID: ${targetId}`, 404));
      }

      if (dbProduct.isActive === false) {
        return next(new ErrorHandler(`Product "${dbProduct.name}" is currently inactive and cannot be ordered.`, 400));
      }

      // Check vendor status
      if (dbProduct.nursery) {
        const nurseryProfile = await NurseryProfile.findOne({ nursery: dbProduct.nursery }).lean();
        if (nurseryProfile && !nurseryProfile.isActive) {
          return next(new ErrorHandler(`Product "${dbProduct.name}" is unavailable because the nursery is temporarily suspended.`, 400));
        }
      }

      // 🛑 Stock availability pre-check (accounting for existing reservations)
      const availableStock = Math.max(0, (dbProduct.stock || 0) - (dbProduct.reservedStock || 0));
      if (availableStock < quantity) {
        return next(
          new ErrorHandler(
            `Only ${availableStock} unit(s) available in stock for "${dbProduct.name}". Requested: ${quantity}.`,
            400
          )
        );
      }

      const effectivePrice = getEffectivePrice(dbProduct.price, dbProduct.discountPrice);

      authoritativeItems.push({
        product: dbProduct,
        modelName,
        itemModel: modelName,
        category: dbProduct.category,
        quantity,
        price: dbProduct.price,
        discountPrice: dbProduct.discountPrice || 0,
        effectivePrice,
      });
    }

    // 🚚 PINCODE SERVICEABILITY VALIDATION ACROSS MULTI-VENDOR ITEMS
    const rawDestinationPincode =
      shippingInfo?.pinCode ||
      shippingInfo?.pincode ||
      req.body.shippingAddress?.pinCode ||
      req.body.shippingAddress?.pincode ||
      req.body.pincode ||
      req.body.pinCode;

    const destinationPincode = rawDestinationPincode
      ? String(rawDestinationPincode).trim()
      : "";

    const uniqueNurseryIds = Array.from(
      new Set(
        authoritativeItems
          .map((ai) => ai.product.nursery?.toString())
          .filter((id): id is string => Boolean(id))
      )
    );

    if (uniqueNurseryIds.length > 0) {
      if (!destinationPincode || !/^[1-9][0-9]{5}$/.test(destinationPincode)) {
        return res.status(400).json({
          status: "fail",
          message: "A valid 6-digit shipping pincode is required to verify delivery serviceability.",
        });
      }

      const nurseryProfiles = await NurseryProfile.find({
        nursery: { $in: uniqueNurseryIds },
      }).lean();

      const profileMap = new Map<string, any>();
      for (const p of nurseryProfiles) {
        if (p.nursery) {
          profileMap.set(p.nursery.toString(), p);
        }
      }

      const itemsToCheck = authoritativeItems.map((ai) => ({
        productId: String(ai.product._id),
        productName: ai.product.name,
        nurseryId: ai.product.nursery ? ai.product.nursery.toString() : null,
      }));

      const serviceability = await checkCartItemsPincodeServiceability(
        destinationPincode,
        itemsToCheck,
        profileMap
      );

      if (!serviceability.isServiceable) {
        return res.status(400).json({
          status: "fail",
          message: "Delivery not available for some items at your pincode",
          unserviceableItems: serviceability.unserviceableItems,
        });
      }
    }

    // 🛡️ 2. PAISE-LEVEL ZERO-FLOAT AUTHORITATIVE TOTALS WITH DYNAMIC GST
    const totals = calculateAuthoritativeTotals(authoritativeItems, taxMap);

    // 🎟️ 2a. SERVER-SIDE COUPON VALIDATION & DYNAMIC DISCOUNT CALCULATION
    const rawCoupon = couponCode || coupon;
    let appliedCouponCode: string | undefined;
    let couponDiscountAmount = 0;

    if (rawCoupon && typeof rawCoupon === "string" && rawCoupon.trim()) {
      try {
        const verifiedCoupon = await verifyCouponInternal(
          rawCoupon,
          totals.itemsPrice,
          req.user?._id
        );
        appliedCouponCode = verifiedCoupon.couponCode;
        couponDiscountAmount = verifiedCoupon.discountAmount;
      } catch (couponErr: any) {
        return next(couponErr);
      }
    }

    const couponDiscountPaise = toPaise(couponDiscountAmount);
    // Final payable in paise: ensure minimum 100 paise (₹1) to satisfy Razorpay gateway requirement
    const finalTotalPaise = Math.max(100, Math.round(totals.totalPricePaise - couponDiscountPaise));

    if (finalTotalPaise <= 0) {
      return next(new ErrorHandler("Computed transaction checkout value must be greater than zero.", 400));
    }

    // 🔒 3. ATOMIC STOCK RESERVATION LOCK (15-Minute TTL)
    // Atomically increments reservedStock across all items with instant rollback on any collision
    const itemsToLock = authoritativeItems.map((ai) => ({
      productId: ai.product._id,
      itemModel: ai.modelName,
      quantity: ai.quantity,
      name: ai.product.name,
      price: ai.effectivePrice,
    }));

    const lockResult = await reserveStockForItems(itemsToLock);
    if (!lockResult.success) {
      return next(
        new ErrorHandler(
          lockResult.failedItem?.reason || "Stock reservation failed. Insufficient available inventory.",
          409
        )
      );
    }

    // 🛡️ Razorpay Notes: Must strictly adhere to max 256 characters per value & max 30 chars per key.
    // Instead of stringifying full large objects (which easily breaches 256 characters),
    // we store safe, truncated customer/order metadata here while storing complete data in MongoDB StockReservation.
    const safeCustomerName = String(req.body.shippingInfo?.name || req.user.name || "Customer").substring(0, 50);
    const safeCustomerEmail = String(req.user?.email || "").substring(0, 100);
    const safeCustomerPhone = String(req.body.shippingInfo?.phone || "").substring(0, 20);
    const safeShippingCity = String(req.body.shippingInfo?.city || "").substring(0, 50);
    const safeShippingPin = String(req.body.shippingInfo?.pinCode || "").substring(0, 10);

    const options = {
      amount: finalTotalPaise, // Accurate to smallest currency unit (Paise) with coupon applied
      currency: "INR",
      receipt: `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      notes: {
        userId: req.user._id.toString(),
        customerName: safeCustomerName,
        customerEmail: safeCustomerEmail,
        customerPhone: safeCustomerPhone,
        shippingCity: safeShippingCity,
        shippingPinCode: safeShippingPin,
        itemCount: String(authoritativeItems.length),
        couponCode: appliedCouponCode ? appliedCouponCode.substring(0, 30) : "",
        couponDiscount: couponDiscountAmount > 0 ? String(couponDiscountAmount).substring(0, 30) : "0",
      },
    };

    let razorpayOrder: any;
    try {
      const instance = getRazorpayInstance();
      razorpayOrder = await instance.orders.create(options);
    } catch (err: any) {
      // 🔄 Gateway order creation failed — rollback reserved stock immediately!
      await rollbackLockedItems(lockResult.lockedItems);
      return next(new ErrorHandler(`Razorpay order creation failed: ${err.message}`, 502));
    }

    // 📝 Persist StockReservation document with 15-minute TTL including authoritative shippingInfo
    let reservation: any = null;
    try {
      reservation = await createStockReservationRecord(
        razorpayOrder.id,
        req.user._id,
        lockResult.lockedItems,
        15,
        undefined,
        req.body.shippingInfo
      );
    } catch (err: any) {
      console.error("🚨 [StockReservation] Error persisting reservation record:", err);
    }

    return res.status(200).json({
      success: true,
      order: razorpayOrder,
      reservation: reservation
        ? {
            id: reservation._id,
            expiresAt: reservation.expiresAt,
            ttlMinutes: 15,
          }
        : undefined,
      calculation: {
        originalItemsPrice: totals.originalItemsPrice,
        discountAmount: totals.discountAmount,
        couponCode: appliedCouponCode,
        couponDiscountAmount,
        itemsPrice: totals.itemsPrice,
        shippingPrice: totals.shippingPrice,
        taxPrice: totals.taxPrice,
        totalPrice: toRupees(finalTotalPaise),
        categoryTaxBreakdown: totals.categoryTaxBreakdown,
      },
    });
  }
);

// ======================================================================
// 🛡️ 2. CRYPTOGRAPHIC PAYMENT VERIFICATION & SECURE ORDER PERSISTENCE
// ======================================================================
export const verifyPayment = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    const paymentInfo = req.body.paymentInfo || {
      razorpay_order_id: req.body.razorpay_order_id,
      razorpay_payment_id: req.body.razorpay_payment_id,
      razorpay_signature: req.body.razorpay_signature,
    };
    const {
      shippingInfo,
      orderItems,
      couponCode,
      coupon,
      shippingAddress,
      pincode,
      pinCode,
    } = req.body;

    const result = await processOrderPlacement({
      paymentInfo,
      shippingInfo,
      orderItems,
      couponCode,
      coupon,
      user: req.user,
      shippingAddress,
      pincode,
      pinCode,
    });

    if (result.status === "EXISTING") {
      return res.status(200).json({
        success: true,
        message: "Order already verified and recorded.",
        order: result.order,
      });
    }

    if (result.status === "UNSERVICEABLE") {
      return res.status(400).json({
        status: "fail",
        message: "Delivery not available for some items at your pincode",
        unserviceableItems: result.unserviceableItems,
      });
    }

    if (result.status === "COLLISION_REFUNDED") {
      return res.status(409).json({
        success: false,
        refunded: result.refunded,
        refundId: result.refundId,
        message: result.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Payment successfully verified and order confirmed.",
      order: result.order,
    });
  }
);
// ======================================================================
// 🪝 3. CRITICAL ASYNCHRONOUS TRANSACTION WEBHOOK INVENTORY MANAGER
// ======================================================================
export const razorpayWebhook = async (req: AuthenticatedRequest, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const signature = req.headers["x-razorpay-signature"] as string;
    if (!signature) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Missing Razorpay verification credentials header." });
    }

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: "Webhook configuration variable stream uninitialized." });
    }

    const shasum = crypto.createHmac("sha256", secret);
    const payload = req.rawBody || (typeof req.body === "string" ? req.body : JSON.stringify(req.body));

    if (!payload) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Webhook payload body data empty." });
    }

    shasum.update(payload);
    const expectedSignature = shasum.digest("hex");
    const bufferExpected = Buffer.from(expectedSignature, "utf-8");
    const bufferReceived = Buffer.from(signature, "utf-8");

    if (
      bufferExpected.length !== bufferReceived.length ||
      !crypto.timingSafeEqual(bufferExpected, bufferReceived)
    ) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Invalid signature validation failed" });
    }

    const bodyData = typeof payload === "string" ? JSON.parse(payload) : payload;

    if (bodyData.event === "order.paid") {
      const paymentEntity = bodyData.payload.payment.entity;
      const orderEntity = bodyData.payload.order.entity;
      const checkoutNotes = orderEntity.notes || {};

      // Check for an already established order entity context (Idempotency)
      const existingOrder = await Order.findOne({ "paymentInfo.id": paymentEntity.id }).session(session);
      if (existingOrder) {
        await session.abortTransaction();
        session.endSession();
        return res.status(200).json({ status: "ok", message: "Duplicate event handled safely." });
      }

      // 🔍 1. Retrieve authoritative order context from StockReservation in MongoDB
      const reservation = await StockReservation.findOne({
        razorpayOrderId: orderEntity.id,
      }).session(session);

      let shippingInfo: any = reservation?.shippingInfo || null;
      let rawOrderItems: any[] = [];
      let userId: string = (reservation?.userId ? reservation.userId.toString() : "") || checkoutNotes.userId || paymentEntity.notes?.userId || "";

      if (reservation && reservation.items && reservation.items.length > 0) {
        rawOrderItems = reservation.items.map((it: any) => ({
          productId: it.productId ? it.productId.toString() : "",
          item: it.productId ? it.productId.toString() : "",
          itemModel: it.itemModel,
          quantity: it.quantity,
          name: it.name,
          price: it.price,
        }));
      }

      // 🔍 2. Fallback to checkoutNotes if legacy order had notes
      if (!shippingInfo && checkoutNotes.shippingInfo) {
        try {
          shippingInfo = typeof checkoutNotes.shippingInfo === "string"
            ? JSON.parse(checkoutNotes.shippingInfo)
            : checkoutNotes.shippingInfo;
        } catch (e) {
          console.warn("⚠️ [Webhook] Could not parse shippingInfo from checkoutNotes:", e);
        }
      }

      if ((!rawOrderItems || rawOrderItems.length === 0) && checkoutNotes.orderItems) {
        try {
          rawOrderItems = typeof checkoutNotes.orderItems === "string"
            ? JSON.parse(checkoutNotes.orderItems)
            : checkoutNotes.orderItems;
        } catch (e) {
          console.warn("⚠️ [Webhook] Could not parse orderItems from checkoutNotes:", e);
        }
      }

      if (!shippingInfo || !rawOrderItems || rawOrderItems.length === 0 || !userId) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          status: "failed",
          message: "Webhook missing required order context (reservation record or tracking notes not found).",
        });
      }

      const taxMap = await getActiveTaxMap();

      // 🔒 RECOMPUTE REAL-TIME LINE ITEMS FROM DATABASE DIRECTLY
      const verifiedOrderItems: any[] = [];
      const authoritativePriceItems: Array<{
        price: number;
        discountPrice?: number;
        quantity: number;
        itemModel?: string;
        category?: string;
      }> = [];

      const rawItemsCache: Array<{ dbProduct: any; modelName: string; quantity: number }> = [];

      for (const item of rawOrderItems) {
        const targetId = item.productId || item.item || item.id || item._id;
        const quantity = Math.max(1, Number(item.quantity) || 1);

        const { product: dbProduct, modelName } = await resolveProductAndModel(
          String(targetId),
          item.itemModel
        );

        if (!dbProduct || !modelName || dbProduct.isActive === false) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ status: "failed", message: "Product context verification failed." });
        }

        authoritativePriceItems.push({
          price: dbProduct.price,
          discountPrice: dbProduct.discountPrice || 0,
          quantity,
          itemModel: modelName,
          category: dbProduct.category,
        });

        rawItemsCache.push({ dbProduct, modelName, quantity });
      }

      const authoritativeTotals = calculateAuthoritativeTotals(authoritativePriceItems, taxMap);

      // ⚡ INTERCEPT AMOUNT MANIPULATION: Cross check physical payment with catalog truth
      const exactAmountPaidPaise = Number(orderEntity.amount_paid);
      if (exactAmountPaidPaise < authoritativeTotals.totalPricePaise) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ status: "failed", message: "Critical Price Discrepancy Exception: Underpayment detected relative to catalog truth." });
      }

      for (let i = 0; i < rawItemsCache.length; i++) {
        const { dbProduct, modelName, quantity } = rawItemsCache[i];
        const effectivePrice = getEffectivePrice(dbProduct.price, dbProduct.discountPrice);
        const taxSnapshot = authoritativeTotals.itemTaxSnapshots[i];

        const lineGross = calcLineGross(effectivePrice, quantity);
        const itemNurseryId = dbProduct.nursery || rawOrderItems[i]?.nursery;
        const commissionInfo = await getEffectiveCommission(itemNurseryId, modelName);
        const commissionRate = commissionInfo.rate;
        const grossPaise = toPaise(lineGross);
        const lineCommission = toRupees(Math.round(grossPaise * commissionRate));
        const lineNurseryEarnings = roundMoney(lineGross - lineCommission);

        verifiedOrderItems.push({
          item: dbProduct._id,
          itemModel: modelName,
          quantity,
          price: effectivePrice,
          priceAtPurchase: effectivePrice,
          originalPrice: dbProduct.price,
          discountPrice: dbProduct.discountPrice || 0,
          taxAmount: taxSnapshot?.taxAmount ?? 0,
          taxRatePercentage: taxSnapshot?.taxRatePercentage ?? 0,
          taxCategory: taxSnapshot?.taxCategory ?? dbProduct.category ?? "General",
          isTaxInclusive: taxSnapshot?.isTaxInclusive ?? false,
          commissionRatePercentage: commissionInfo.percentage,
          commissionAmount: lineCommission,
          nurseryEarnings: lineNurseryEarnings,
          nursery: dbProduct.nursery ? dbProduct.nursery.toString() : rawOrderItems[i]?.nursery,
          status: "Processing",
          commissionAudit: {
            originalCommission: lineCommission,
            commissionRate,
            lineGross,
            status: "ACTIVE",
          },
        });
      }

      // 🔍 5. STOCK RESERVATION STATUS EVALUATION
      const isReservationPending =
        reservation && reservation.status === "PENDING";

      // 🛒 TRANSACTIONAL STOCK LOCK DOWN
      const lowStockAlertItems: { nurseryId?: string; name: string; stock: number }[] = [];

      if (isReservationPending) {
        // 🔒 PATH A: Active reservation — commit atomically
        const commitRes = await commitStockReservation(orderEntity.id, session);
        if (!commitRes.success && commitRes.status !== "ALREADY_COMMITTED") {
          await session.abortTransaction();
          session.endSession();
          return res.status(500).json({
            status: "failed",
            message: "Failed to commit stock reservation.",
          });
        }

        for (const item of verifiedOrderItems) {
          const TargetModel = getCaseInsensitiveModel(item.itemModel);
          if (TargetModel) {
            const productDoc = await TargetModel.findById(item.item).session(session);
            if (
              productDoc &&
              typeof productDoc.stock === "number" &&
              productDoc.stock <= 5
            ) {
              lowStockAlertItems.push({
                nurseryId: item.nursery?.toString(),
                name: productDoc.name || "Product",
                stock: productDoc.stock,
              });
            }
          }
        }
      } else {
        // 🛒 PATH B: No active reservation / TTL expired — attempt atomic deduction
        let stockDepleted = false;

        for (const item of verifiedOrderItems) {
          const TargetModel = getCaseInsensitiveModel(item.itemModel)!;
          const updatedInventoryItem = await TargetModel.findOneAndUpdate(
            {
              _id: item.item,
              isActive: true,
              $expr: {
                $gte: [
                  {
                    $subtract: [
                      { $ifNull: ["$stock", 0] },
                      { $ifNull: ["$reservedStock", 0] },
                    ],
                  },
                  Number(item.quantity),
                ],
              },
            },
            { $inc: { stock: -Number(item.quantity) } },
            { new: true, session }
          );

          if (!updatedInventoryItem) {
            stockDepleted = true;
            break;
          }

          if (
            typeof updatedInventoryItem.stock === "number" &&
            updatedInventoryItem.stock <= 5
          ) {
            lowStockAlertItems.push({
              nurseryId: item.nursery?.toString(),
              name: updatedInventoryItem.name || "Product",
              stock: updatedInventoryItem.stock,
            });
          }
        }

        if (stockDepleted) {
          await session.abortTransaction();
          session.endSession();

          // 💸 Automated fallback refund for webhook
          const refundResult = await processFallbackRefund({
            razorpayPaymentId: paymentEntity.id,
            razorpayOrderId: orderEntity.id,
            amountPaise: exactAmountPaidPaise,
            userId: userId,
            customerEmail: paymentEntity.email,
            customerName: paymentEntity.notes?.customerName || shippingInfo?.name || "Customer",
            reason: "STOCK_DEPLETED_POST_TTL_WEBHOOK",
            orderItems: verifiedOrderItems,
          });

          return res.status(200).json({
            status: "refunded",
            refundId: refundResult.refundId,
            message:
              "Stock reservation expired and inventory depleted. Fallback refund initiated automatically.",
          });
        }
      }

      // 📝 ATOMICALLY CREATE PLATFORM ORDER RECORD
      const [newOrder] = await Order.create(
        [
          {
            shippingInfo,
            orderItems: verifiedOrderItems,
            user: userId,
            paymentInfo: {
              id: paymentEntity.id,
              orderId: orderEntity.id,
              status: paymentEntity.status || "captured",
            },
            itemsPrice: authoritativeTotals.itemsPrice,
            taxPrice: authoritativeTotals.taxPrice,
            shippingPrice: authoritativeTotals.shippingPrice,
            totalPrice: exactAmountPaidPaise > authoritativeTotals.totalPricePaise ? toRupees(exactAmountPaidPaise) : authoritativeTotals.totalPrice,
            paidAt: new Date(),
          },
        ],
        { session }
      );

      // Ledger entries
      const ledgerEntries = verifiedOrderItems.map((item) => ({
        nursery: item.nursery,
        entryType: "COMMISSION_CHARGED" as const,
        amount: item.commissionAudit?.originalCommission ?? 0,
        direction: "DEBIT" as const,
        description: `Commission charged on sale — Order #${newOrder._id} | ${item.itemModel} ×${item.quantity}`,
        orderId: newOrder._id,
        orderItemId: item._id,
        metadata: {
          itemModel: item.itemModel,
          commissionRate: item.commissionAudit?.commissionRate ?? 0,
          lineGross: item.commissionAudit?.lineGross ?? 0,
          quantity: item.quantity,
        },
      }));
      await TransactionLedger.insertMany(ledgerEntries, { session });

      await session.commitTransaction();
      session.endSession();

      // Dispatch Notifications
      const oid = newOrder._id.toString();
      sendOrderConfirmationEmail(oid).catch((err) =>
        console.error("❌ [Email Trigger Failed] Event: OrderConfirmation (Webhook), Error:", err?.message)
      );
      sendAdminNewOrderEmail(
        oid,
        authoritativeTotals.totalPrice,
        shippingInfo.name || paymentEntity.notes?.customerName || "Customer",
        newOrder.orderItems.length
      ).catch((err) =>
        console.error("❌ [Email Trigger Failed] Event: AdminNewOrder (Webhook), Error:", err?.message)
      );

      const nurseryGroupMap = new Map<string, any[]>();
      newOrder.orderItems.forEach((item: any) => {
        if (item.nursery) {
          const nId = item.nursery.toString();
          if (!nurseryGroupMap.has(nId)) nurseryGroupMap.set(nId, []);
          nurseryGroupMap.get(nId)!.push(item);
        }
      });

      for (const [nurseryId, items] of nurseryGroupMap.entries()) {
        sendNurseryOrderAlertEmail(
          nurseryId,
          oid,
          items,
          newOrder.shippingInfo.city,
          newOrder.shippingInfo.pinCode
        ).catch((err) =>
          console.error("❌ [Email Trigger Failed] Event: NurseryOrderAlert (Webhook), Error:", err?.message)
        );
      }

      if (lowStockAlertItems.length > 0) {
        (async () => {
          for (const lItem of lowStockAlertItems) {
            if (!lItem.nurseryId) continue;
            try {
              const vendor = await User.findById(lItem.nurseryId).select("name email").lean();
              if (vendor?.email) {
                sendLowStockAlert(vendor.email, (vendor as any).name || "Nursery Owner", lItem.name, lItem.stock).catch((err) =>
                  console.error("❌ [Email Trigger Failed] Event: LowStockAlert (Webhook), Error:", err?.message)
                );
              }
            } catch (err: any) {
              console.error("Error looking up vendor for low stock alert:", err?.message);
            }
          }
        })().catch((err) => console.error("Error in low stock background dispatch:", err));
      }
    } else if (bodyData.event === "payment.failed") {
      const paymentEntity = bodyData.payload?.payment?.entity;
      const orderEntity = bodyData.payload?.order?.entity;
      const orderId = paymentEntity?.order_id || orderEntity?.id;

      // 🔓 Immediately release any pending stock reservation for this failed order
      if (orderId) {
        await releaseStockReservation(orderId, "PAYMENT_FAILED_WEBHOOK");
      }

      if (paymentEntity?.email) {
        const customerName = paymentEntity.notes?.customerName || "Customer";
        const frontendUrl = process.env.FRONTEND_URL?.trim() || "http://localhost:3000";
        const retryUrl = `${frontendUrl.replace(/\/+$/, "")}/checkout`;

        sendEmail({
          email: paymentEntity.email,
          subject: `⚠️ Payment Failed for Order #${orderId || "PENDING"} — Urban Nursery`,
          message: `Hi ${customerName}, your payment could not be processed. Please retry checkout.`,
          html: getPaymentFailedHtml(customerName, orderId || "PENDING", retryUrl),
        }).catch((err) =>
          console.error("❌ [Email Trigger Failed] Event: PaymentFailed, Error:", err?.message)
        );
      }

      await session.commitTransaction();
      session.endSession();
    } else {
      await session.commitTransaction();
      session.endSession();
    }

    return res.status(200).json({ status: "ok" });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    console.error("Critical Webhook processing crash error:", error);
    return res.status(500).json({ message: "Internal server error during event tracking operations." });
  }
};

// ======================================================================
// 🛑 4. CANCEL RAZORPAY ORDER / RELEASE STOCK RESERVATION
// ======================================================================
export const cancelRazorpayOrder = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    const razorpayOrderId =
      req.body.razorpayOrderId ||
      req.body.orderId ||
      req.body.draftOrderId;

    if (!razorpayOrderId) {
      return next(
        new ErrorHandler(
          "Order reference (razorpayOrderId, orderId, or draftOrderId) is required to cancel reservation.",
          400
        )
      );
    }

    // 1. Locate the stock reservation
    const reservation = await StockReservation.findOne({
      $or: [
        { razorpayOrderId },
        { _id: mongoose.isValidObjectId(razorpayOrderId) ? razorpayOrderId : null },
      ].filter(Boolean),
    });

    if (!reservation) {
      // Check if an existing order document exists for this reference
      const existingOrder = await Order.findOne({
        $or: [
          { "paymentInfo.razorpay_order_id": razorpayOrderId },
          { "paymentInfo.id": razorpayOrderId },
          { _id: mongoose.isValidObjectId(razorpayOrderId) ? razorpayOrderId : null },
        ].filter(Boolean),
      });

      if (existingOrder) {
        const sessionUserId = req.user?._id?.toString();
        if (
          sessionUserId &&
          existingOrder.user?.toString() !== sessionUserId &&
          req.user?.role !== "admin"
        ) {
          return next(new ErrorHandler("You are not authorized to cancel this order.", 403));
        }

        if (existingOrder.orderStatus === "Processing") {
          existingOrder.orderStatus = "Cancelled";
          await existingOrder.save();
        }

        return res.status(200).json({
          success: true,
          released: true,
          orderStatus: existingOrder.orderStatus,
          message: "Order cancelled successfully.",
        });
      }

      return res.status(200).json({
        success: true,
        released: false,
        message: "No pending stock reservation or draft order found for this reference.",
      });
    }

    // 2. Validate session ownership / authorization
    const sessionUserId = req.user?._id?.toString();
    const reservationUserId = reservation.userId?.toString();
    const guestToken =
      req.headers["x-guest-token"] ||
      req.body.guestToken ||
      req.body.sessionToken;

    const isOwner = sessionUserId && reservationUserId && sessionUserId === reservationUserId;
    const isAdmin = req.user?.role === "admin";
    const isMatchingGuest =
      guestToken &&
      ((reservation as any).guestToken === guestToken ||
        (reservation.shippingInfo && (reservation.shippingInfo as any).guestToken === guestToken));
    const isMatchingBodyUserId =
      req.body.userId &&
      reservationUserId &&
      String(req.body.userId).trim() === reservationUserId;

    if (sessionUserId) {
      if (!isOwner && !isAdmin) {
        return next(
          new ErrorHandler("You are not authorized to cancel this order reservation.", 403)
        );
      }
    } else if (!isMatchingGuest && !isMatchingBodyUserId) {
      return next(
        new ErrorHandler("Authentication or valid guest token required to release reservation.", 401)
      );
    }

    // 3. Atomically release reserved stock back to available inventory
    const releaseReason = req.body.reason || "USER_CANCELLED";
    const result = await releaseStockReservation(reservation.razorpayOrderId, releaseReason);

    // 4. Mark associated draft/pending order status as 'Cancelled' if present
    let orderCancelled = false;
    const associatedOrder = await Order.findOne({
      $or: [
        { "paymentInfo.razorpay_order_id": reservation.razorpayOrderId },
        { "paymentInfo.id": reservation.razorpayOrderId },
      ],
    });

    if (associatedOrder && associatedOrder.orderStatus === "Processing") {
      associatedOrder.orderStatus = "Cancelled";
      await associatedOrder.save();
      orderCancelled = true;
    }

    return res.status(200).json({
      success: true,
      released: result.success,
      reservationStatus: result.success ? "RELEASED" : reservation.status,
      orderStatus: orderCancelled ? "Cancelled" : undefined,
      message: result.success
        ? "Stock reservation successfully released back to available inventory."
        : "Reservation was not pending or was already released.",
    });
  }
);