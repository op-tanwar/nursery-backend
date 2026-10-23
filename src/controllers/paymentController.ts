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
    const { orderItems } = req.body;

    if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
      return next(new ErrorHandler("Order items validation sequence mapping failed. Items array required.", 400));
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

    // 🛡️ 2. PAISE-LEVEL ZERO-FLOAT AUTHORITATIVE TOTALS WITH DYNAMIC GST
    const totals = calculateAuthoritativeTotals(authoritativeItems, taxMap);

    if (totals.totalPricePaise <= 0) {
      return next(new ErrorHandler("Computed transaction checkout value must be greater than zero.", 400));
    }

    const minimalTrackingItems = authoritativeItems.map((ai) => ({
      item: ai.product._id.toString(),
      itemModel: ai.modelName,
      category: ai.category,
      quantity: ai.quantity,
      nursery: ai.product.nursery ? ai.product.nursery.toString() : "",
    }));

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

    const options = {
      amount: totals.totalPricePaise, // Accurate to smallest currency unit (Paise)
      currency: "INR",
      receipt: `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      notes: {
        userId: req.user._id.toString(),
        shippingInfo: JSON.stringify(req.body.shippingInfo || {}),
        orderItems: JSON.stringify(minimalTrackingItems),
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

    // 📝 Persist StockReservation document with 15-minute TTL
    let reservation: any = null;
    try {
      reservation = await createStockReservationRecord(
        razorpayOrder.id,
        req.user._id,
        lockResult.lockedItems,
        15
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
        itemsPrice: totals.itemsPrice,
        shippingPrice: totals.shippingPrice,
        taxPrice: totals.taxPrice,
        totalPrice: totals.totalPrice,
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
    const { shippingInfo, orderItems } = req.body;

    if (!paymentInfo || !paymentInfo.razorpay_order_id || !paymentInfo.razorpay_payment_id || !paymentInfo.razorpay_signature) {
      return next(new ErrorHandler("Cryptographic payment credentials (order_id, payment_id, signature) are required.", 400));
    }

    if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
      return next(new ErrorHandler("Order items array is required.", 400));
    }

    if (!process.env.RAZORPAY_KEY_SECRET) {
      return next(new ErrorHandler("Server configuration error: Payment secret key uninitialized.", 500));
    }

    // 🔒 1. CRYPTOGRAPHIC SIGNATURE VERIFICATION (Zero bypass allowed)
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${paymentInfo.razorpay_order_id}|${paymentInfo.razorpay_payment_id}`)
      .digest("hex");

    const bufferExpected = Buffer.from(expectedSignature, "utf-8");
    const bufferReceived = Buffer.from(paymentInfo.razorpay_signature, "utf-8");

    if (bufferExpected.length !== bufferReceived.length || !crypto.timingSafeEqual(bufferExpected, bufferReceived)) {
      return next(new ErrorHandler("Payment signature verification failed. Untrusted or tampered transaction credentials.", 400));
    }

    // 🔒 2. VERIFY AGAINST RAZORPAY API TO PREVENT ORDER AMOUNT TAMPERING
    const razorpay = getRazorpayInstance();
    let rzpOrder: any;
    try {
      rzpOrder = await razorpay.orders.fetch(paymentInfo.razorpay_order_id);
    } catch (err: any) {
      return next(new ErrorHandler(`Failed to fetch order from payment gateway: ${err.message}`, 400));
    }

    const taxMap = await getActiveTaxMap();

    // 🔒 3. RECALCULATE AUTHORITATIVE PRICES FRESHLY FROM MONGODB
    const verifiedOrderItems: any[] = [];
    const authoritativePriceItems: Array<{
      price: number;
      discountPrice?: number;
      quantity: number;
      itemModel?: string;
      category?: string;
    }> = [];

    const dbProductsCache: Array<{ dbProduct: any; modelName: string; quantity: number }> = [];

    for (const item of orderItems) {
      const targetId = item.productId || item.item || item.id || item._id;
      const quantity = Math.max(1, Number(item.quantity) || 1);

      const { product: dbProduct, modelName } = await resolveProductAndModel(
        String(targetId),
        item.itemModel
      );

      if (!dbProduct || !modelName) {
        return next(new ErrorHandler(`Product reference not found: ${targetId}`, 404));
      }

      if (dbProduct.isActive === false) {
        return next(new ErrorHandler(`Product "${dbProduct.name}" is no longer active for commerce.`, 400));
      }

      authoritativePriceItems.push({
        price: dbProduct.price,
        discountPrice: dbProduct.discountPrice || 0,
        quantity,
        itemModel: modelName,
        category: dbProduct.category,
      });

      dbProductsCache.push({ dbProduct, modelName, quantity });
    }

    const authoritativeTotals = calculateAuthoritativeTotals(authoritativePriceItems, taxMap);

    // ⚡ INTERCEPT AMOUNT MANIPULATION: Cross check Razorpay charged amount with catalog truth
    const chargedAmountPaise = Number(rzpOrder.amount);
    const expectedAmountPaise = authoritativeTotals.totalPricePaise;

    // Strict guard against malicious underpayment (e.g. client tampering with checkout amounts)
    if (chargedAmountPaise < expectedAmountPaise) {
      console.error(
        `🚨 [Security Alert] Underpayment detected! Catalog requires ₹${authoritativeTotals.totalPrice} (${expectedAmountPaise} paise), but gateway was charged ₹${chargedAmountPaise / 100} (${chargedAmountPaise} paise). User: ${req.user?._id}`
      );
      return next(
        new ErrorHandler(
          `Payment amount mismatch! Expected ₹${authoritativeTotals.totalPrice} (${expectedAmountPaise} paise), but gateway was charged ₹${chargedAmountPaise / 100} (${chargedAmountPaise} paise).`,
          400
        )
      );
    }

    // Graceful audit log if gateway was charged more (e.g., transition fallback or legacy order)
    if (chargedAmountPaise > expectedAmountPaise) {
      console.warn(
        `⚠️ [Payment Audit] Gateway charged ₹${chargedAmountPaise / 100} (${chargedAmountPaise} paise) while current catalog total is ₹${authoritativeTotals.totalPrice} (${expectedAmountPaise} paise). Permitting order verification to preserve customer funds.`
      );
    }

    // 🛡️ 4. IDEMPOTENCY CHECK: Prevent duplicate order processing for the same payment
    let existingOrder = await Order.findOne({ "paymentInfo.id": paymentInfo.razorpay_payment_id });
    if (existingOrder) {
      return res.status(200).json({
        success: true,
        message: "Order already verified and recorded.",
        order: existingOrder,
      });
    }

    // Build verified items using itemTaxSnapshots
    for (let i = 0; i < dbProductsCache.length; i++) {
      const { dbProduct, modelName, quantity } = dbProductsCache[i];
      const effectivePrice = getEffectivePrice(dbProduct.price, dbProduct.discountPrice);
      const taxSnapshot = authoritativeTotals.itemTaxSnapshots[i];

      const lineGross = calcLineGross(effectivePrice, quantity);
      const commissionInfo = await getEffectiveCommission(dbProduct.nursery, modelName);
      const commissionRate = commissionInfo.rate;
      const grossPaise = toPaise(lineGross);
      const lineCommission = toRupees(Math.round(grossPaise * commissionRate));
      const lineNurseryEarnings = roundMoney(lineGross - lineCommission);

      verifiedOrderItems.push({
        item: dbProduct._id,
        itemModel: modelName,
        quantity,
        price: effectivePrice,
        priceAtPurchase: effectivePrice, // 🛡️ Snapshot exact purchase price
        originalPrice: dbProduct.price,
        discountPrice: dbProduct.discountPrice || 0,
        taxAmount: taxSnapshot?.taxAmount ?? 0,
        taxRatePercentage: taxSnapshot?.taxRatePercentage ?? 0,
        taxCategory: taxSnapshot?.taxCategory ?? dbProduct.category ?? "General",
        isTaxInclusive: taxSnapshot?.isTaxInclusive ?? false,
        commissionRatePercentage: commissionInfo.percentage,
        commissionAmount: lineCommission,
        nurseryEarnings: lineNurseryEarnings,
        nursery: dbProduct.nursery,
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
    const reservation = await StockReservation.findOne({
      razorpayOrderId: paymentInfo.razorpay_order_id,
    });

    const isReservationPending =
      reservation && reservation.status === "PENDING";

    // 🔒 6. ATOMIC INVENTORY REDUCTION & ORDER CREATION
    const lowStockAlertItems: { nurseryId?: string; name: string; stock: number }[] = [];
    let savedOrder: any = null;

    try {
      await withTransaction(async (session) => {
        const updateOpts = session ? { session } : {};

        if (isReservationPending) {
          // 🔒 PATH A: Active 15-minute reservation held — commit stock deduction atomically
          const commitRes = await commitStockReservation(
            paymentInfo.razorpay_order_id,
            session
          );
          if (!commitRes.success && commitRes.status !== "ALREADY_COMMITTED") {
            throw new Error(
              `Failed to commit stock reservation for order: ${paymentInfo.razorpay_order_id}`
            );
          }

          for (const item of verifiedOrderItems) {
            const TargetModel = getCaseInsensitiveModel(item.itemModel);
            if (TargetModel) {
              const productDoc = await TargetModel.findById(item.item).session(
                session || null
              );
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
          // ⚠️ PATH B: Reservation was RELEASED (15-min TTL expired) or NOT FOUND!
          // Customer finalized payment after timeout — attempt on-the-fly inventory deduction
          let stockAllocationFailed = false;
          let failedItemDetail: any = null;
          const successfullyDeducted: Array<{
            model: any;
            id: any;
            quantity: number;
          }> = [];

          for (const item of verifiedOrderItems) {
            const TargetModel = getCaseInsensitiveModel(item.itemModel)!;
            const updatedStock = await TargetModel.findOneAndUpdate(
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
                    item.quantity,
                  ],
                },
              },
              { $inc: { stock: -item.quantity } },
              { new: true, ...updateOpts }
            );

            if (!updatedStock) {
              stockAllocationFailed = true;
              failedItemDetail = item;
              break;
            }

            successfullyDeducted.push({
              model: TargetModel,
              id: item.item,
              quantity: item.quantity,
            });

            if (
              typeof updatedStock.stock === "number" &&
              updatedStock.stock <= 5
            ) {
              lowStockAlertItems.push({
                nurseryId: item.nursery?.toString(),
                name: updatedStock.name || "Product",
                stock: updatedStock.stock,
              });
            }
          }

          if (stockAllocationFailed) {
            if (!session) {
              for (const d of successfullyDeducted) {
                await d.model.findByIdAndUpdate(d.id, {
                  $inc: { stock: d.quantity },
                });
              }
            }
            const collisionErr = new Error("STOCK_COLLISION_DEPLETED_POST_TTL");
            (collisionErr as any).isStockDepletedPostTtl = true;
            (collisionErr as any).failedItem = failedItemDetail;
            throw collisionErr;
          }
        }

        const createOpts = session ? { session } : {};
        const [newOrder] = await Order.create(
          [
            {
              shippingInfo,
              orderItems: verifiedOrderItems,
              user: req.user._id,
              paymentInfo: {
                id: paymentInfo.razorpay_payment_id,
                orderId: paymentInfo.razorpay_order_id,
                status: "captured",
              },
              itemsPrice: authoritativeTotals.itemsPrice,
              taxPrice: authoritativeTotals.taxPrice,
              shippingPrice: authoritativeTotals.shippingPrice,
              totalPrice:
                chargedAmountPaise > authoritativeTotals.totalPricePaise
                  ? toRupees(chargedAmountPaise)
                  : authoritativeTotals.totalPrice,
              paidAt: new Date(),
            },
          ],
          createOpts
        );

        savedOrder = newOrder;

        // 📒 Ledger accounting entries for multi-vendor commissions
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

        await TransactionLedger.insertMany(ledgerEntries, createOpts);
      });
    } catch (err: any) {
      if (err?.isStockDepletedPostTtl) {
        // 🚨 Stock oversold/depleted post-TTL! Execute automated Razorpay fallback refund engine
        const refundResult = await processFallbackRefund({
          razorpayPaymentId: paymentInfo.razorpay_payment_id,
          razorpayOrderId: paymentInfo.razorpay_order_id,
          amountPaise: chargedAmountPaise,
          userId: req.user?._id,
          customerEmail: req.user?.email,
          customerName: req.user?.name,
          reason: "STOCK_COLLISION_POST_TTL",
          orderItems: verifiedOrderItems,
        });

        return res.status(409).json({
          success: false,
          refunded: refundResult.success,
          refundId: refundResult.refundId,
          message:
            "Item(s) in your cart were sold out because the 15-minute checkout reservation expired. A 100% full refund has been automatically initiated to your original payment method.",
        });
      }
      throw err;
    }

    // 📧 Fire-and-forget notifications
    if (savedOrder) {
      const oid = savedOrder._id.toString();
      sendOrderConfirmationEmail(oid).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: OrderConfirmation, Error:", e?.message || e)
      );
      sendAdminNewOrderEmail(
        oid,
        savedOrder.totalPrice,
        req.user?.name || "Customer",
        savedOrder.orderItems.length
      ).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: AdminNewOrder, Error:", e?.message || e)
      );

      const nurseryMap = new Map<string, any[]>();
      for (const item of savedOrder.orderItems) {
        const nid = item.nursery?.toString();
        if (nid) {
          if (!nurseryMap.has(nid)) nurseryMap.set(nid, []);
          nurseryMap.get(nid)!.push(item);
        }
      }
      for (const [nid, items] of nurseryMap) {
        sendNurseryOrderAlertEmail(
          nid,
          oid,
          items,
          savedOrder.shippingInfo.city,
          savedOrder.shippingInfo.pinCode
        ).catch((e) =>
          console.error("❌ [Email Trigger Failed] Event: NurseryOrderAlert, Error:", e?.message || e)
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
                  console.error("❌ [Email Trigger Failed] Event: LowStockAlert, Error:", err?.message)
                );
              }
            } catch (err: any) {
              console.error("Error looking up vendor for low stock alert:", err?.message);
            }
          }
        })().catch((err) => console.error("Error in low stock background dispatch:", err));
      }
    }

    return res.status(201).json({
      success: true,
      message: "Payment successfully verified and order confirmed.",
      order: savedOrder,
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
      const checkoutNotes = orderEntity.notes;

      if (!checkoutNotes || !checkoutNotes.shippingInfo || !checkoutNotes.orderItems) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ status: "failed", message: "Webhook missing tracking notes payload structure." });
      }

      // Check for an already established order entity context (Idempotency)
      const existingOrder = await Order.findOne({ "paymentInfo.id": paymentEntity.id }).session(session);
      if (existingOrder) {
        await session.abortTransaction();
        session.endSession();
        return res.status(200).json({ status: "ok", message: "Duplicate event handled safely." });
      }

      const shippingInfo = JSON.parse(checkoutNotes.shippingInfo);
      const rawOrderItems = JSON.parse(checkoutNotes.orderItems);

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
      const reservation = await StockReservation.findOne({
        razorpayOrderId: orderEntity.id,
      }).session(session);

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
            userId: checkoutNotes.userId,
            customerEmail: paymentEntity.email,
            customerName: paymentEntity.notes?.customerName || "Customer",
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
            user: checkoutNotes.userId,
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
    const { razorpayOrderId } = req.body;

    if (!razorpayOrderId) {
      return next(new ErrorHandler("Razorpay Order ID is required to cancel reservation.", 400));
    }

    const result = await releaseStockReservation(razorpayOrderId, "USER_CANCELLED");

    return res.status(200).json({
      success: true,
      released: result.success,
      message: result.success
        ? "Stock reservation successfully released."
        : "Reservation was not pending or was already released.",
    });
  }
);