import { Request, Response, NextFunction } from "express";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import Order from "../models/orderModel";
import TransactionLedger from "../models/transactionLedgerModel";
import Product from "../models/productModel";
import {
  modelRegistry,
  getCaseInsensitiveModel,
  resolveProductAndModel,
} from "../utils/productRegistry";
import * as crypto from "node:crypto";
import cloudinary from "cloudinary";
import mongoose from "mongoose";
import {
  sendOrderConfirmationEmail,
  sendNurseryOrderAlertEmail,
  sendAdminNewOrderEmail,
  sendOrderDeliveredEmail,
  sendOrderShippedEmail,
  sendOrderStatusProgressionEmail,
  sendOrderCancellationEmails,
  sendOrderStatusChangeEmail,
  sendReviewRequestEmail,
  sendClaimAlertToAdmin,
  sendClaimAlertToNursery,
} from "../utils/orderEmailService";
import { sendLowStockAlert } from "../templates/emails";
import User from "../models/userModel";
import NurseryProfile from "../models/nurseryProfileModel";
import Coupon from "../models/couponModel";
import { verifyCouponInternal } from "./couponController";
import { checkCartAvailability } from "./cartController";
import {
  getCommissionRate,
  calcLineGross,
  calcLineCommission,
  roundMoney,
} from "../utils/financialUtils";
import {
  getEffectivePrice,
  calculateAuthoritativeTotals,
  calculateServerShippingAndTax,
  toRupees,
  toPaise,
} from "../utils/pricingUtils";
import { withTransaction } from "../utils/transactionHelper";
import { getRazorpayInstance } from "./paymentController";
import StockReservation from "../models/stockReservationModel";
import { commitStockReservation } from "../services/stockReservationService";
import { processFallbackRefund } from "../services/fallbackRefundService";
import { getActiveTaxMap } from "../utils/taxService";
import { getEffectiveCommission } from "../utils/commissionService";
import {
  checkCartItemsPincodeServiceability,
  isPincodeServiceable,
} from "../utils/pincodeService";
import {
  processOrderPlacement,
  OrderPlacementService,
} from "../services/orderPlacementService";
import { createClaimRequest } from "./returnClaimController";

export { modelRegistry, getCaseInsensitiveModel, calculateServerShippingAndTax };

// ======================================================================
// 🚀 1. VERIFY & CREATE ORDER CHECKPOINT (ZERO-TRUST AUTHORITATIVE PRICING)
// ======================================================================
export const createNewOrder = catchAsyncErrors(
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
      return res.status(201).json({
        success: true,
        message: "Payment successfully validated, order pipeline synchronized cleanly.",
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
      message: "Payment successfully validated, order pipeline synchronized cleanly.",
      order: result.order,
    });
  }
);
// ======================================================================
// 🔍 2. GET SINGLE ORDER (SECURED WITH STRICT IDOR / BOLA GUARDS)
// ======================================================================
export const getSingleOrder = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    // 1. Authentication Guard: Must be an authenticated user
    if (!req.user) {
      return next(new ErrorHandler("Please login to access this order", 401));
    }

    const rawId = req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId || "").trim();

    // 2. ID Validation First: Must be a valid 24-character hexadecimal MongoDB ObjectId
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return next(
        new ErrorHandler(
          "Invalid order ID format. Must be a valid 24-character ObjectId.",
          400
        )
      );
    }

    // 3. Fetch Order by ID with populated relational schemas
    const order = await Order.findById(id)
      .populate("user", "name email phone role avatar")
      .populate("orderItems.item")
      .populate({
        path: "orderItems.nursery",
        select: "name businessName logo phone email avatar",
        strictPopulate: false,
      });

    if (!order) {
      return next(new ErrorHandler(`Order not found with ID: ${id}`, 404));
    }

    const currentUserId = req.user._id.toString();
    const isAdmin = req.user.role === "admin";

    // Customer / Owner check
    const rawOrderUser: any = order.user;
    const orderUserId = rawOrderUser
      ? (rawOrderUser._id ? rawOrderUser._id.toString() : rawOrderUser.toString())
      : null;
    const isOwner = Boolean(orderUserId && orderUserId === currentUserId);

    // Resolve nursery profile ID if caller is a nursery vendor
    let userNurseryProfileId: string | null = null;
    if (req.user.role === "nursery") {
      const nurseryDoc = await NurseryProfile.findOne({ nursery: req.user._id })
        .select("_id")
        .lean();
      if (nurseryDoc?._id) {
        userNurseryProfileId = nurseryDoc._id.toString();
      }
    }

    const reqNurseryId = (req.user as any).nurseryId
      ? String((req.user as any).nurseryId)
      : null;

    // Associated Nursery check: Does order contain any items from this nursery?
    const isAssociatedNursery =
      Array.isArray(order.orderItems) &&
      order.orderItems.some((item: any) => {
        const itemNurseryId =
          typeof item.nursery === "object" && item.nursery !== null
            ? item.nursery._id?.toString()
            : item.nursery?.toString();
        return (
          itemNurseryId === currentUserId ||
          (userNurseryProfileId && itemNurseryId === userNurseryProfileId) ||
          (reqNurseryId && itemNurseryId === reqNurseryId)
        );
      });

    // 4. Strict Authorization Matrix:
    // Only Admin, Order Owner (Customer), or an Associated Nursery may access the order
    if (!isAdmin && !isOwner && !isAssociatedNursery) {
      return next(
        new ErrorHandler("You are not authorized to view this order", 403)
      );
    }

    // 5. Convert to plain object & enrich nursery details
    const orderObj: any = order.toObject ? order.toObject() : order;
    const nurseryUserIds: string[] = Array.from(
      new Set(
        (orderObj.orderItems || [])
          .map((item: any) =>
            typeof item.nursery === "object" && item.nursery !== null
              ? item.nursery._id?.toString()
              : item.nursery?.toString()
          )
          .filter(Boolean)
      )
    );

    const nurseryProfiles =
      nurseryUserIds.length > 0
        ? await NurseryProfile.find({
            $or: [
              { nursery: { $in: nurseryUserIds } },
              { _id: { $in: nurseryUserIds.filter((nid) => mongoose.Types.ObjectId.isValid(nid)) } },
            ],
          }).lean()
        : [];

    const profileMap = new Map<string, any>();
    nurseryProfiles.forEach((p: any) => {
      if (p.nursery) profileMap.set(p.nursery.toString(), p);
      if (p._id) profileMap.set(p._id.toString(), p);
    });

    orderObj.orderItems = (orderObj.orderItems || []).map((oi: any) => {
      const nId =
        typeof oi.nursery === "object" && oi.nursery !== null
          ? oi.nursery._id?.toString()
          : oi.nursery?.toString();
      const nProfile = profileMap.get(nId);
      const productDoc = oi.item || oi.product || {};

      return {
        ...oi,
        item: productDoc,
        product: productDoc,
        nursery: {
          ...(typeof oi.nursery === "object" ? oi.nursery : { _id: oi.nursery }),
          name:
            nProfile?.businessName ||
            (typeof oi.nursery === "object" ? oi.nursery?.name : "Verified Nursery"),
          businessName:
            nProfile?.businessName ||
            (typeof oi.nursery === "object"
              ? oi.nursery?.businessName || oi.nursery?.name
              : "Verified Nursery"),
          slug: nProfile?.slug || nProfile?._id?.toString() || nId,
          avatar: nProfile?.avatar?.url,
          logo: nProfile?.coverImage?.url,
        },
      };
    });

    // 6. Associated Nursery Data Filtering (Data Isolation)
    // If accessed by an associated nursery (and not admin or owner),
    // strictly isolate items so they can ONLY view their own items and earnings.
    if (isAssociatedNursery && !isAdmin && !isOwner) {
      orderObj.orderItems = (orderObj.orderItems || []).filter((item: any) => {
        const itemNurseryId =
          typeof item.nursery === "object" && item.nursery !== null
            ? item.nursery._id?.toString()
            : item.nursery?.toString();
        return (
          itemNurseryId === currentUserId ||
          (userNurseryProfileId && itemNurseryId === userNurseryProfileId) ||
          (reqNurseryId && itemNurseryId === reqNurseryId)
        );
      });

      // Recalculate totals specifically for this nursery's items
      const nurseryItemsPrice = orderObj.orderItems.reduce(
        (sum: number, it: any) =>
          sum + (Number(it.price || it.priceAtPurchase || 0) * Number(it.quantity || 1)),
        0
      );
      const nurseryTaxPrice = orderObj.orderItems.reduce(
        (sum: number, it: any) => sum + Number(it.taxAmount || 0),
        0
      );

      orderObj.itemsPrice = nurseryItemsPrice;
      orderObj.taxPrice = nurseryTaxPrice;
      orderObj.totalPrice = nurseryItemsPrice + nurseryTaxPrice;
    }

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[OrderController] Order "${id}" successfully retrieved by user "${currentUserId}" (${req.user.role}). Status: "${orderObj.orderStatus}"`
      );
    }

    res.status(200).json({ success: true, order: orderObj });
  }
);

// Alias getOrderById to getSingleOrder for compatibility
export const getOrderById = getSingleOrder;


// ======================================================================
// 👤 3. LOGGED-IN USER ORDERS (WITH MEMORY PROTECTION PAGINATION)
// ======================================================================
export const myOrders = catchAsyncErrors(async (req: Request, res: Response) => {
  const resPerPage = 10; // Standard layout processing metrics limit
  const currentPage = Number(req.query.page) || 1;
  const skip = resPerPage * (currentPage - 1);

  // ⚡ PERF: Parallelize count and find with .lean() to eliminate Mongoose document hydration
  const [totalOrdersCount, orders] = await Promise.all([
    Order.countDocuments({ user: req.user?._id }),
    Order.find({ user: req.user?._id })
      .populate("orderItems.item")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(resPerPage)
      .lean(),
  ]);

  res.status(200).json({
    success: true,
    totalOrdersCount,
    resPerPage,
    currentPage,
    totalPages: Math.ceil(totalOrdersCount / resPerPage),
    orders
  });
});

// ======================================================================
// 🛡️ 4. ADMIN — GET ALL ORDERS (WITH MEMORY PROTECTION PAGINATION)
// ======================================================================
export const getAllOrders = catchAsyncErrors(async (req: Request, res: Response) => {
  const page = Number(req.query.page) || 1;
  const rawLimit = Number(req.query.limit) || 20;
  const limit = Math.min(Math.max(rawLimit, 1), 100);
  const skip = (page - 1) * limit;

  // ⚡ PERF: Parallel query execution with .lean()
  const [totalOrdersCount, orders] = await Promise.all([
    Order.countDocuments(),
    Order.find()
      .populate("user", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  res.status(200).json({
    success: true,
    totalOrdersCount,
    page,
    limit,
    orders,
  });
});

// ======================================================================
// 🏡 5. NURSERY — VENDOR-SPECIFIC ORDERS (WITH DB PAGINATION ACCELERATION)
// ======================================================================
export const getMyNurseryOrders = catchAsyncErrors(async (req: Request, res: Response) => {
  const nurseryId = req.user?._id.toString();
  const resPerPage = 10;
  const currentPage = Number(req.query.page) || 1;
  const skip = resPerPage * (currentPage - 1);

  const filterQuery = { "orderItems.nursery": req.user?._id };

  // ⚡ PERF: Parallel query execution with .lean()
  const [totalOrdersCount, orders] = await Promise.all([
    Order.countDocuments(filterQuery),
    Order.find(filterQuery)
      .populate("orderItems.item")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(resPerPage)
      .lean<any[]>(),
  ]);

  // Clean sub-items context map arrays to keep vendor privacy metrics pristine
  const filteredOrders = orders.map((order) => ({
    ...order,
    orderItems: (order.orderItems || []).filter(
      (item: any) => item.nursery?.toString() === nurseryId
    ),
  }));

  res.status(200).json({
    success: true,
    totalOrdersCount,
    resPerPage,
    currentPage,
    totalPages: Math.ceil(totalOrdersCount / resPerPage),
    orders: filteredOrders
  });
});

interface ProcessOrderRefundParams {
  order: any;
  amountRupees: number;
  reason: string;
  notes?: Record<string, string>;
}

interface ProcessOrderRefundResult {
  success: boolean;
  refundId?: string;
  refundAmount: number;
  refundStatus: "PROCESSED" | "FAILED" | "PENDING_MANUAL_REVIEW";
  failureReason?: string;
  isOnlinePayment: boolean;
  skipped: boolean;
}

/**
 * 💸 Helper to securely process automated Razorpay refund for cancelled orders or items.
 * Enforces idempotency, paise conversion, double-refund prevention, and graceful manual review fallback.
 */
const processOrderRefund = async (
  params: ProcessOrderRefundParams
): Promise<ProcessOrderRefundResult> => {
  const { order, reason, notes = {} } = params;
  const paymentId = order.paymentInfo?.id;
  const isOnlinePayment = Boolean(
    paymentId &&
    typeof paymentId === "string" &&
    paymentId.startsWith("pay_")
  );

  // 1. Calculate previously processed refunds across items and order to prevent double-refunding
  const previouslyRefunded =
    (order.orderItems || []).reduce((acc: number, it: any) => {
      if (it.refundDetails?.refundStatus === "PROCESSED") {
        return acc + (Number(it.refundDetails.refundAmount) || 0);
      }
      return acc;
    }, 0) +
    (order.refundDetails?.refundStatus === "PROCESSED"
      ? Number(order.refundDetails.refundAmount) || 0
      : 0);

  const remainingRefundable = roundMoney(
    Math.max(0, (order.totalPrice || 0) - previouslyRefunded)
  );
  const actualRefundRupees = roundMoney(
    Math.min(params.amountRupees, remainingRefundable)
  );

  if (actualRefundRupees <= 0) {
    return {
      success: true,
      refundAmount: 0,
      refundStatus: "PROCESSED",
      isOnlinePayment,
      skipped: true,
    };
  }

  // If not an online payment via Razorpay, mark as processed without calling gateway
  if (!isOnlinePayment) {
    return {
      success: true,
      refundAmount: actualRefundRupees,
      refundStatus: "PROCESSED",
      isOnlinePayment: false,
      skipped: false,
    };
  }

  const amountPaise = toPaise(actualRefundRupees);

  try {
    const razorpay = getRazorpayInstance();
    const safeReason = (reason || "Order Cancellation").substring(0, 250);

    const safeNotes: Record<string, string> = {
      orderId: order._id.toString(),
      reason: safeReason,
    };

    for (const [k, v] of Object.entries(notes)) {
      if (v) safeNotes[k] = String(v).substring(0, 250);
    }

    const refund = await razorpay.payments.refund(paymentId, {
      amount: amountPaise,
      speed: "normal",
      notes: safeNotes,
    });

    return {
      success: true,
      refundId: refund.id,
      refundAmount: actualRefundRupees,
      refundStatus: "PROCESSED",
      isOnlinePayment: true,
      skipped: false,
    };
  } catch (error: any) {
    console.error(
      `🚨 [OrderRefund] Razorpay refund failed for Order #${order._id} (Payment: ${paymentId}):`,
      error.message || error
    );

    return {
      success: false,
      refundAmount: actualRefundRupees,
      refundStatus: "PENDING_MANUAL_REVIEW",
      failureReason: error.message || "Gateway refund API call failed",
      isOnlinePayment: true,
      skipped: false,
    };
  }
};

// ======================================================================
// 🛡️ 6. ADMIN — UPDATE STATUS & DYNAMIC STOCK REVERT
// ======================================================================
export const updateOrderAdmin = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const status = req.body.status || req.body.orderStatus;
    const normalizedStatus = status === "Completed" ? "Delivered" : status;

    const validStatuses = ["Processing", "Shipped", "Out for Delivery", "Delivered", "Cancelled"];
    if (!validStatuses.includes(normalizedStatus)) {
      return next(new ErrorHandler(`Invalid status code received: ${status}`, 400));
    }

    let updatedOrder: any = null;

    await withTransaction(async (session) => {
      const orderQuery = Order.findById(req.params.id);
      if (session) orderQuery.session(session);
      const order = await orderQuery;

      if (!order) {
        throw new ErrorHandler("Order not found", 404);
      }

      if (order.orderStatus === "Delivered" || order.orderStatus === "Cancelled") {
        throw new ErrorHandler(`Order already processed as ${order.orderStatus}`, 400);
      }

      if (normalizedStatus === "Cancelled") {
        const ledgerEntries: any[] = [];
        const newlyCancelledItems: any[] = [];

        for (const item of order.orderItems) {
          // 🛡️ IDEMPOTENCY GUARD: Skip items already cancelled — never reverse commission twice
          if (item.status === "Cancelled") continue;

          // Restock inventory directly on unified Product model
          const updateOpts = session ? { session } : {};
          await Product.findByIdAndUpdate(
            item.item,
            { $inc: { stock: item.quantity } },
            updateOpts
          );

          // 💰 Calculate reversal amount using centralized paise-safe math
          const lineGross = calcLineGross(item.price, item.quantity);
          const commissionToReverse = calcLineCommission(lineGross, item.itemModel);
          const commRate = await getCommissionRate(item.itemModel);

          // Mark commissionAudit as reversed
          item.commissionAudit = {
            originalCommission: (item.commissionAudit as any)?.originalCommission ?? commissionToReverse,
            commissionRate: commRate,
            lineGross,
            status: "CANCELLED_COMMISSION_REVERSED",
            reversedAt: new Date(),
          };

          item.status = "Cancelled";
          newlyCancelledItems.push(item);

          // 📒 Queue a COMMISSION_REVERSED ledger entry (CREDIT back to nursery)
          if (item.nursery) {
            ledgerEntries.push({
              nursery: item.nursery,
              entryType: "COMMISSION_REVERSED",
              amount: commissionToReverse,
              direction: "CREDIT",
              description: `Commission reversed on cancellation — Order #${order._id} | ${item.itemModel} ×${item.quantity}`,
              orderId: order._id,
              orderItemId: item._id,
              metadata: {
                itemModel: item.itemModel,
                commissionRate: commRate,
                lineGross,
                quantity: item.quantity,
              },
            });
          }
        }

        // 💸 AUTOMATED CUSTOMER REFUND: Full order cancellation
        const cancellationReason = req.body.reason || req.body.cancellationReason || "Admin Order Cancellation";
        const refundResult = await processOrderRefund({
          order,
          amountRupees: order.totalPrice,
          reason: cancellationReason,
        });

        order.refundDetails = {
          refundId: refundResult.refundId,
          refundStatus: refundResult.refundStatus,
          refundAmount: refundResult.refundAmount,
          refundedAt: refundResult.success ? new Date() : undefined,
          reason: cancellationReason,
          failureReason: refundResult.failureReason,
        };

        // Record item-level refund details for newly cancelled items
        for (const item of newlyCancelledItems) {
          if (item.refundDetails?.refundStatus !== "PROCESSED") {
            const itemTotal = roundMoney(calcLineGross(item.price, item.quantity) + (item.taxAmount || 0));
            item.refundDetails = {
              refundId: refundResult.refundId,
              refundStatus: refundResult.refundStatus,
              refundAmount: itemTotal,
              refundedAt: refundResult.success ? new Date() : undefined,
              reason: cancellationReason,
              failureReason: refundResult.failureReason,
            };
          }
        }

        if (refundResult.success && !refundResult.skipped && refundResult.refundAmount > 0) {
          ledgerEntries.push({
            entryType: "CUSTOMER_REFUND",
            amount: refundResult.refundAmount,
            direction: "DEBIT",
            description: `Automated customer refund (${refundResult.refundId || "N/A"}) for Order #${order._id} cancellation`,
            orderId: order._id,
            metadata: {
              refundId: refundResult.refundId,
              paymentId: order.paymentInfo?.id,
              refundAmountRupees: refundResult.refundAmount,
              reason: "ADMIN_FULL_ORDER_CANCELLATION",
            },
          });
        }

        // Write all ledger entries atomically
        if (ledgerEntries.length > 0) {
          const insertOpts = session ? { session } : {};
          await TransactionLedger.insertMany(ledgerEntries, insertOpts);
        }
      }

      order.orderStatus = normalizedStatus;
      if (normalizedStatus === "Delivered") {
        order.deliveredAt = new Date();
        order.orderItems.forEach((item) => {
          if (item.status !== "Cancelled") item.status = "Delivered";
        });
      } else if (normalizedStatus === "Shipped" || normalizedStatus === "Out for Delivery") {
        order.orderItems.forEach((item) => {
          if (item.status !== "Cancelled" && item.status !== "Delivered") item.status = normalizedStatus;
        });
      }

      const saveOpts = session ? { session } : {};
      await order.save(saveOpts);
      updatedOrder = order;
    });

    const oid = updatedOrder._id.toString();
    const trackingDetails = {
      trackingCourier: req.body.trackingCourier || req.body.courier,
      trackingId: req.body.trackingId || req.body.trackingNumber,
      trackingUrl: req.body.trackingUrl,
    };

    if (normalizedStatus === "Delivered") {
      sendOrderDeliveredEmail(oid).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: OrderDelivered, Error:", e?.message || e)
      );
      sendReviewRequestEmail(oid).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: ReviewRequest, Error:", e?.message || e)
      );
    } else if (normalizedStatus === "Shipped") {
      sendOrderShippedEmail(oid, trackingDetails).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: OrderShipped, Error:", e?.message || e)
      );
    } else if (normalizedStatus === "Out for Delivery") {
      sendOrderStatusProgressionEmail(oid, "Out for Delivery", trackingDetails).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: OutForDelivery, Error:", e?.message || e)
      );
    } else if (normalizedStatus === "Cancelled") {
      sendOrderCancellationEmails(oid, req.body.reason || req.body.cancellationReason).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: OrderCancelled, Error:", e?.message || e)
      );
    } else {
      sendOrderStatusChangeEmail(oid, normalizedStatus).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: OrderStatusChange, Error:", e?.message || e)
      );
    }

    res.status(200).json({ success: true, order: updatedOrder });
  }
);


// ======================================================================
// 🏡 7. NURSERY — VENDOR STATUS UPDATE & PARTIAL STOCK REVERT
// ======================================================================
export const updateOrderNursery = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { status, trackingCourier, trackingId, trackingUrl, reason, cancellationReason } = req.body;
    const allowedStatus = ["Processing", "Shipped", "Out for Delivery", "Delivered", "Cancelled"];
    if (!allowedStatus.includes(status)) return next(new ErrorHandler("Invalid status type", 400));

    let updated = false;
    let finalOrder: any = null;

    await withTransaction(async (session) => {
      const orderQuery = Order.findById(req.params.id);
      if (session) orderQuery.session(session);
      const order = await orderQuery;

      if (!order) {
        throw new ErrorHandler("Order not found", 404);
      }

      const currentNurseryId = req.user?._id.toString();
      const ledgerEntries: any[] = [];
      const nurseryCancelledItems: any[] = [];
      let nurseryCancelledItemsTotal = 0;

      for (const item of order.orderItems) {
        if (item.nursery?.toString() === currentNurseryId) {
          if (item.status === "Cancelled" || item.status === "Delivered") {
            throw new ErrorHandler(`Item is already marked as ${item.status}`, 400);
          }

          if (status === "Cancelled") {
            const updateOpts = session ? { session } : {};
            await Product.findByIdAndUpdate(item.item, { $inc: { stock: item.quantity } }, updateOpts);

            // 💰 Calculate reversal amount using centralized paise-safe math
            const lineGross = calcLineGross(item.price, item.quantity);
            const commissionToReverse = calcLineCommission(lineGross, item.itemModel);

            const commRate = await getCommissionRate(item.itemModel);

            item.commissionAudit = {
              originalCommission: (item.commissionAudit as any)?.originalCommission ?? commissionToReverse,
              commissionRate: commRate,
              lineGross,
              status: "CANCELLED_COMMISSION_REVERSED",
              reversedAt: new Date(),
            };

            const itemLineTotal = roundMoney(lineGross + (item.taxAmount || 0));
            nurseryCancelledItemsTotal = roundMoney(nurseryCancelledItemsTotal + itemLineTotal);
            nurseryCancelledItems.push(item);

            ledgerEntries.push({
              nursery: item.nursery,
              entryType: "COMMISSION_REVERSED",
              amount: commissionToReverse,
              direction: "CREDIT",
              description: `Commission reversed on nursery cancellation — Order #${order._id} | ${item.itemModel} ×${item.quantity}`,
              orderId: order._id,
              orderItemId: item._id,
              metadata: {
                itemModel: item.itemModel,
                commissionRate: commRate,
                lineGross,
                quantity: item.quantity,
              },
            });
          }

          item.status = status;
          updated = true;
        }
      }

      if (!updated) {
        throw new ErrorHandler("Unauthorized multi-vendor action", 403);
      }

      // 💸 AUTOMATED CUSTOMER REFUND: Partial nursery item cancellation
      if (status === "Cancelled" && nurseryCancelledItems.length > 0) {
        // Check if all items in the order are now cancelled
        const allItemsNowCancelled = order.orderItems.every((it) => it.status === "Cancelled");

        // If all items in the order become cancelled, include any unrefunded shipping
        let totalToRefund = nurseryCancelledItemsTotal;
        if (allItemsNowCancelled && order.shippingPrice > 0) {
          totalToRefund = roundMoney(totalToRefund + order.shippingPrice);
        }

        const cancelReason = reason || cancellationReason || "Nursery Item Cancellation";
        const refundResult = await processOrderRefund({
          order,
          amountRupees: totalToRefund,
          reason: cancelReason,
          notes: {
            nurseryId: currentNurseryId || "",
          },
        });

        // Set refundDetails for each cancelled item
        for (const it of nurseryCancelledItems) {
          const itemPortion = roundMoney(calcLineGross(it.price, it.quantity) + (it.taxAmount || 0));
          it.refundDetails = {
            refundId: refundResult.refundId,
            refundStatus: refundResult.refundStatus,
            refundAmount: itemPortion,
            refundedAt: refundResult.success ? new Date() : undefined,
            reason: cancelReason,
            failureReason: refundResult.failureReason,
          };
        }

        if (allItemsNowCancelled) {
          order.refundDetails = {
            refundId: refundResult.refundId,
            refundStatus: refundResult.refundStatus,
            refundAmount: refundResult.refundAmount,
            refundedAt: refundResult.success ? new Date() : undefined,
            reason: cancelReason,
            failureReason: refundResult.failureReason,
          };
        }

        if (refundResult.success && !refundResult.skipped && refundResult.refundAmount > 0) {
          ledgerEntries.push({
            entryType: "CUSTOMER_REFUND",
            amount: refundResult.refundAmount,
            direction: "DEBIT",
            description: `Partial customer refund (${refundResult.refundId || "N/A"}) on nursery cancellation — Order #${order._id}`,
            orderId: order._id,
            metadata: {
              refundId: refundResult.refundId,
              paymentId: order.paymentInfo?.id,
              refundAmountRupees: refundResult.refundAmount,
              reason: "NURSERY_ITEM_CANCELLED",
            },
          });
        }
      }

      if (ledgerEntries.length > 0) {
        const insertOpts = session ? { session } : {};
        await TransactionLedger.insertMany(ledgerEntries, insertOpts);
      }

      const allItemsCancelled = order.orderItems.every((item) => item.status === "Cancelled");
      if (allItemsCancelled) {
        order.orderStatus = "Cancelled";
      }

      const allItemsDeliveredOrCancelled = order.orderItems.every((item) => ["Delivered", "Cancelled"].includes(item.status));
      if (allItemsDeliveredOrCancelled && !allItemsCancelled) {
        order.orderStatus = "Delivered";
        order.deliveredAt = new Date();
      }

      const saveOpts = session ? { session } : {};
      await order.save(saveOpts);
      finalOrder = order;
    });

    const oid = finalOrder._id.toString();
    const allItemsCancelled = finalOrder.orderItems.every((item: any) => item.status === "Cancelled");
    const allItemsDeliveredOrCancelled = finalOrder.orderItems.every((item: any) => ["Delivered", "Cancelled"].includes(item.status));

    if (allItemsCancelled) {
      sendOrderCancellationEmails(oid, reason || cancellationReason).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: OrderCancelled (Nursery), Error:", e?.message || e)
      );
    } else if (allItemsDeliveredOrCancelled) {
      sendOrderDeliveredEmail(oid).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: OrderDelivered (Nursery), Error:", e?.message || e)
      );
      sendReviewRequestEmail(oid).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: ReviewRequest (Nursery), Error:", e?.message || e)
      );
    } else if (status === "Shipped") {
      sendOrderShippedEmail(oid, {
        trackingCourier: trackingCourier || req.body.courier,
        trackingId: trackingId || req.body.trackingNumber,
        trackingUrl: trackingUrl,
      }).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: OrderShipped (Nursery), Error:", e?.message || e)
      );
    } else if (status === "Out for Delivery") {
      sendOrderStatusProgressionEmail(oid, "Out for Delivery", {
        trackingCourier: trackingCourier || req.body.courier,
        trackingId: trackingId || req.body.trackingNumber,
        trackingUrl: trackingUrl,
      }).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: OutForDelivery (Nursery), Error:", e?.message || e)
      );
    } else if (status === "Processing") {
      sendOrderStatusChangeEmail(oid, "Processing").catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: OrderProcessing (Nursery), Error:", e?.message || e)
      );
    }

    res.status(200).json({ success: true, message: `Status updated to ${status}` });
  }
);

// ======================================================================
// 🛡️ 8. ADMIN — DELETE ORDER (WITH AUTOMATIC INVENTORY RESTORATION)
// ======================================================================
export const deleteOrder = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    await withTransaction(async (session) => {
      const orderQuery = Order.findById(req.params.id);
      if (session) orderQuery.session(session);
      const order = await orderQuery;

      if (!order) {
        throw new ErrorHandler("Order not found", 404);
      }

      if (order.orderStatus !== "Cancelled") {
        for (const item of order.orderItems) {
          if (item.status !== "Cancelled") {
            const updateOpts = session ? { session } : {};
            await Product.findByIdAndUpdate(item.item, { $inc: { stock: item.quantity } }, updateOpts);
          }
        }

        // 💸 Automated refund if deleted while active and paid online
        await processOrderRefund({
          order,
          amountRupees: order.totalPrice,
          reason: "Order Deleted by Administrator",
        });
      }

      const deleteOpts = session ? { session } : {};
      await order.deleteOne(deleteOpts);
    });

    res.status(200).json({ success: true, message: "Order deleted and stock balanced successfully" });
  }
);

// ======================================================================
// 🛡️ 9. USER — CLAIM REPLACEMENT / REFUND (DELEGATED TO UNIFIED CLAIM CONTROLLER)
// ======================================================================
export const requestItemClaim = createClaimRequest;