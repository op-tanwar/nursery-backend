import { Request, Response, NextFunction } from "express";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import Order from "../models/orderModel";
import TransactionLedger from "../models/transactionLedgerModel";
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
    const { shippingInfo, orderItems } = req.body;

    if (!paymentInfo || !paymentInfo.razorpay_order_id || !paymentInfo.razorpay_payment_id || !paymentInfo.razorpay_signature) {
      return next(new ErrorHandler("Payment details (order_id, payment_id, signature) are incomplete or missing", 400));
    }

    if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
      return next(new ErrorHandler("Order items list is empty or invalid.", 400));
    }

    if (!process.env.RAZORPAY_KEY_SECRET) {
      return next(new ErrorHandler("Critical production cryptographic environment variables missing.", 500));
    }

    // 🔒 1. CRYPTOGRAPHIC SIGNATURE VERIFICATION (Zero bypass allowed)
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${paymentInfo.razorpay_order_id}|${paymentInfo.razorpay_payment_id}`)
      .digest("hex");

    const bufferGenerated = Buffer.from(generatedSignature, "utf-8");
    const bufferReceived = Buffer.from(paymentInfo.razorpay_signature, "utf-8");

    if (bufferGenerated.length !== bufferReceived.length || !crypto.timingSafeEqual(bufferGenerated, bufferReceived)) {
      return next(new ErrorHandler("Payment verification failed! Invalid or tampered transaction credentials.", 400));
    }

    // 🔒 2. VERIFY ORDER RECORD WITH RAZORPAY GATEWAY DIRECTLY
    const razorpay = getRazorpayInstance();
    let rzpOrder: any;
    try {
      rzpOrder = await razorpay.orders.fetch(paymentInfo.razorpay_order_id);
    } catch (err: any) {
      return next(new ErrorHandler(`Payment gateway order verification failed: ${err.message}`, 400));
    }

    const taxMap = await getActiveTaxMap();

    // 🔒 3. RECALCULATE AUTHORITATIVE PRICES FRESHLY FROM MONGODB (DISCARD CLIENT PRICES)
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
        return next(new ErrorHandler(`Product reference identity context vanished: ${targetId}`, 404));
      }

      if (dbProduct.isActive === false) {
        return next(new ErrorHandler(`Product ${dbProduct.name} is no longer active for commerce transactions.`, 400));
      }

      if (dbProduct.nursery) {
        const nurseryProfile = await NurseryProfile.findOne({ nursery: dbProduct.nursery }).lean();
        if (nurseryProfile && !nurseryProfile.isActive) {
          return next(new ErrorHandler(`Product "${dbProduct.name}" is unavailable because the nursery is temporarily suspended.`, 400));
        }
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

    // 🛡️ Strictly calculate metrics server-side, discarding raw input parameters
    const authoritativeTotals = calculateAuthoritativeTotals(authoritativePriceItems, taxMap);

    // ⚡ Cross check Gateway charged amount with authoritative catalog total
    const chargedAmountPaise = Number(rzpOrder.amount);
    const expectedAmountPaise = authoritativeTotals.totalPricePaise;

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

    if (chargedAmountPaise > expectedAmountPaise) {
      console.warn(
        `⚠️ [Payment Audit] Gateway charged ₹${chargedAmountPaise / 100} (${chargedAmountPaise} paise) while current catalog total is ₹${authoritativeTotals.totalPrice} (${expectedAmountPaise} paise). Permitting order confirmation to preserve customer funds.`
      );
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
        nursery: dbProduct.nursery, // 🛡️ Enforce db-authoritative vendor split allocation
        status: "Processing",
        commissionAudit: {
          originalCommission: lineCommission,
          commissionRate,
          lineGross,
          status: "ACTIVE",
        },
      });
    }

    // 🛡️ IDEMPOTENCY CHECK: Multi-submit / replay query interception
    let activeVerifiedOrder = await Order.findOne({ "paymentInfo.id": paymentInfo.razorpay_payment_id });
    const lowStockItems: { nurseryId?: string; name: string; stock: number }[] = [];

    // 🔍 5. STOCK RESERVATION STATUS EVALUATION
    const reservation = await StockReservation.findOne({
      razorpayOrderId: paymentInfo.razorpay_order_id,
    });

    const isReservationPending =
      reservation && reservation.status === "PENDING";

    if (!activeVerifiedOrder) {
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
                  lowStockItems.push({
                    nurseryId: item.nursery?.toString(),
                    name: productDoc.name || item.name || "Product",
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
              const targetItemId = new mongoose.Types.ObjectId(item.item);

              const updatedInventory = await TargetModel.findOneAndUpdate(
                {
                  _id: targetItemId,
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
                { new: true, ...updateOpts }
              );

              if (!updatedInventory) {
                stockAllocationFailed = true;
                failedItemDetail = item;
                break;
              }

              successfullyDeducted.push({
                model: TargetModel,
                id: targetItemId,
                quantity: Number(item.quantity),
              });

              if (
                typeof updatedInventory.stock === "number" &&
                updatedInventory.stock <= 5
              ) {
                lowStockItems.push({
                  nurseryId: item.nursery?.toString(),
                  name: updatedInventory.name || item.name || "Product",
                  stock: updatedInventory.stock,
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
          const [instantOrder] = await Order.create(
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
          activeVerifiedOrder = instantOrder;

          // 📒 Write COMMISSION_CHARGED ledger entries for each item inside the same transaction
          const ledgerEntries = verifiedOrderItems.map((item) => ({
            nursery: item.nursery,
            entryType: "COMMISSION_CHARGED" as const,
            amount: item.commissionAudit?.originalCommission ?? 0,
            direction: "DEBIT" as const,
            description: `Commission charged on sale — Order #${instantOrder._id} | ${item.itemModel} ×${item.quantity}`,
            orderId: instantOrder._id,
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
    }

    // Fire-and-forget email notifications
    if (activeVerifiedOrder) {
      const oid = activeVerifiedOrder._id.toString();
      sendOrderConfirmationEmail(oid).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: OrderConfirmation, Error:", e?.message || e)
      );
      sendAdminNewOrderEmail(
        oid,
        activeVerifiedOrder.totalPrice,
        req.user?.name || "Customer",
        activeVerifiedOrder.orderItems.length
      ).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: AdminNewOrder, Error:", e?.message || e)
      );

      // Notify each nursery with their relevant items
      const nurseryItemsMap = new Map<string, any[]>();
      for (const item of activeVerifiedOrder.orderItems) {
        const nid = item.nursery?.toString();
        if (nid) {
          if (!nurseryItemsMap.has(nid)) nurseryItemsMap.set(nid, []);
          nurseryItemsMap.get(nid)!.push(item);
        }
      }
      for (const [nurseryId, items] of nurseryItemsMap) {
        sendNurseryOrderAlertEmail(
          nurseryId,
          oid,
          items,
          activeVerifiedOrder.shippingInfo.city,
          activeVerifiedOrder.shippingInfo.pinCode
        ).catch((e) =>
          console.error("❌ [Email Trigger Failed] Event: NurseryOrderAlert, Error:", e?.message || e)
        );
      }

      // Non-blocking: Dispatch low stock alerts to nurseries
      if (lowStockItems.length > 0) {
        (async () => {
          for (const lItem of lowStockItems) {
            if (!lItem.nurseryId) continue;
            try {
              const vendor = await User.findById(lItem.nurseryId).select("name email").lean();
              if (vendor?.email) {
                sendLowStockAlert(
                  vendor.email,
                  (vendor as any).name || "Nursery Owner",
                  lItem.name,
                  lItem.stock
                ).catch((err) =>
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

    res.status(201).json({
      success: true,
      message: "Payment successfully validated, order pipeline synchronized cleanly.",
      order: activeVerifiedOrder
    });
  }
);

// ======================================================================
// 🔍 2. GET SINGLE ORDER
// ======================================================================
export const getSingleOrder = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId || "").trim();

    if (process.env.NODE_ENV !== "production") {
      console.log(`[OrderController] GET single order request received. ID: "${id}"`);
    }

    if (!id) {
      return next(new ErrorHandler("Order ID parameter is required.", 400));
    }

    // 1. Prioritize MongoDB _id lookup first, with orderId and paymentInfo fallbacks
    const isValidObjectId = mongoose.Types.ObjectId.isValid(id);
    const orderQuery = isValidObjectId
      ? {
          $or: [
            { _id: id },
            { orderId: id },
            { "paymentInfo.orderId": id },
            { "paymentInfo.id": id },
          ],
        }
      : {
          $or: [
            { orderId: id },
            { "paymentInfo.orderId": id },
            { "paymentInfo.id": id },
          ],
        };

    // 2. Fetch order with populated relational schemas defensively
    const order = await Order.findOne(orderQuery)
      .populate("user", "name email phone role avatar")
      .populate("orderItems.item")
      .populate({
        path: "orderItems.nursery",
        select: "name businessName logo phone email avatar",
        strictPopulate: false,
      });

    if (!order) {
      console.warn(`[OrderController] Order not found for ID: "${id}"`);
      return next(new ErrorHandler(`Order not found with ID: ${id}`, 404));
    }

    const currentUserId = req.user?._id?.toString();
    const isAdmin = req.user?.role === "admin";
    const isOwner =
      order.user &&
      ((typeof order.user === "object" && (order.user as any)._id?.toString() === currentUserId) ||
        order.user.toString() === currentUserId);
    const isAssociatedNursery =
      Array.isArray(order.orderItems) &&
      order.orderItems.some((item: any) => {
        const itemNurseryId =
          typeof item.nursery === "object"
            ? item.nursery?._id?.toString()
            : item.nursery?.toString();
        return itemNurseryId === currentUserId;
      });

    // 3. Allow logged-in owner, admin, or associated nursery.
    // Also do NOT block public/guest lookup if the user opened an order confirmation link with a valid 24-char order ID.
    if (req.user && !isAdmin && !isOwner && !isAssociatedNursery && !isValidObjectId) {
      console.warn(`[OrderController] Access denied for user "${currentUserId}" on order "${id}"`);
      return next(new ErrorHandler("You are not authorized to view this order", 403));
    }

    // 4. Enrich order with nursery profile and product aliases for frontend compatibility
    const orderObj: any = order.toObject ? order.toObject() : order;
    const nurseryUserIds: string[] = Array.from(
      new Set(
        (orderObj.orderItems || [])
          .map((item: any) =>
            typeof item.nursery === "object"
              ? item.nursery?._id?.toString()
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
        typeof oi.nursery === "object"
          ? oi.nursery?._id?.toString()
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

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[OrderController] Order "${id}" successfully retrieved. Status: "${orderObj.orderStatus}"`
      );
    }

    if (isAssociatedNursery && !isAdmin && !isOwner) {
      orderObj.orderItems = (orderObj.orderItems || []).filter((item: any) => {
        const itemNurseryId =
          typeof item.nursery === "object"
            ? item.nursery?._id?.toString()
            : item.nursery?.toString();
        return itemNurseryId === currentUserId;
      });
      return res.status(200).json({ success: true, order: orderObj });
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

        for (const item of order.orderItems) {
          // 🛡️ IDEMPOTENCY GUARD: Skip items already cancelled — never reverse commission twice
          if (item.status === "Cancelled") continue;

          // Restock inventory
          const TargetModel = getCaseInsensitiveModel(item.itemModel);
          if (TargetModel) {
            const updateOpts = session ? { session } : {};
            await TargetModel.findByIdAndUpdate(
              item.item,
              { $inc: { stock: item.quantity } },
              updateOpts
            );
          }

          // 💰 Calculate reversal amount using centralized paise-safe math
          const lineGross = calcLineGross(item.price, item.quantity);
          const commissionToReverse = calcLineCommission(lineGross, item.itemModel);

          // Mark commissionAudit as reversed
          item.commissionAudit = {
            originalCommission: (item.commissionAudit as any)?.originalCommission ?? commissionToReverse,
            commissionRate: await getCommissionRate(item.itemModel),
            lineGross,
            status: "CANCELLED_COMMISSION_REVERSED",
            reversedAt: new Date(),
          };

          item.status = "Cancelled";

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
                commissionRate: getCommissionRate(item.itemModel),
                lineGross,
                quantity: item.quantity,
              },
            });
          }
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

      for (const item of order.orderItems) {
        if (item.nursery?.toString() === currentNurseryId) {
          if (item.status === "Cancelled" || item.status === "Delivered") {
            throw new ErrorHandler(`Item is already marked as ${item.status}`, 400);
          }

          if (status === "Cancelled") {
            const TargetModel = getCaseInsensitiveModel(item.itemModel);
            if (TargetModel) {
              const updateOpts = session ? { session } : {};
              await TargetModel.findByIdAndUpdate(item.item, { $inc: { stock: item.quantity } }, updateOpts);
            }

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
            const TargetModel = getCaseInsensitiveModel(item.itemModel);
            if (TargetModel) {
              const updateOpts = session ? { session } : {};
              await TargetModel.findByIdAndUpdate(item.item, { $inc: { stock: item.quantity } }, updateOpts);
            }
          }
        }
      }

      const deleteOpts = session ? { session } : {};
      await order.deleteOne(deleteOpts);
    });

    res.status(200).json({ success: true, message: "Order deleted and stock balanced successfully" });
  }
);

// ======================================================================
// 🛡️ 9. USER — CLAIM REPLACEMENT / REFUND
// ======================================================================
export const requestItemClaim = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { orderId, itemId, claimType, reason } = req.body;

    if (!req.files || Object.keys(req.files).length === 0) {
      return next(new ErrorHandler("Unboxing proof (photo/video) is strictly mandatory.", 400));
    }

    const proofFile = req.files.proof as any;
    if (!proofFile) {
      return next(new ErrorHandler("Please upload a file under the field name 'proof'.", 400));
    }

    if (!["Replacement", "Refund"].includes(claimType)) {
      return next(new ErrorHandler("Invalid claim type. Must be Replacement or Refund.", 400));
    }

    const order = await Order.findById(orderId);
    if (!order) return next(new ErrorHandler("Order not found", 404));

    if (order.user.toString() !== req.user?._id.toString()) {
      return next(new ErrorHandler("Unauthorized action for this order context.", 403));
    }

    if (order.orderStatus !== "Delivered" || !order.deliveredAt) {
      return next(new ErrorHandler("Claims can only be filed for successfully delivered orders.", 400));
    }

    const timeSinceDelivery = Date.now() - new Date(order.deliveredAt).getTime();
    if (timeSinceDelivery / (1000 * 60 * 60) > 48) {
      return next(new ErrorHandler("Policy expired. Claims must be submitted within 48 hours of delivery.", 400));
    }

    const item = order.orderItems.find(
      (item) => item.item.toString() === itemId && item.status === "Delivered"
    );

    if (!item) {
      return next(new ErrorHandler("Delivered inventory item not found in this order sequence.", 404));
    }

    if (item.claim?.isClaimed) {
      return next(new ErrorHandler("A claim has already been filed for this particular item.", 400));
    }

    let proofUrl = "";
    try {
      const result = await cloudinary.v2.uploader.upload(proofFile.tempFilePath, {
        folder: "urban_nursery_claims",
        resource_type: "auto",
      });
      proofUrl = result.secure_url;
    } catch (uploadError: any) {
      return next(new ErrorHandler(`Unboxing proof upload failed: ${uploadError.message}`, 500));
    }

    item.claim = {
      isClaimed: true,
      claimType,
      reason,
      proofUrl,
      status: "Pending",
      claimedAt: new Date()
    };

    item.status = "Claimed";
    await order.save();

    res.status(200).json({
      success: true,
      message: "Claim submitted successfully. It will be reviewed within 24 hours.",
      claimStatus: "Pending"
    });

    try {
      const populatedOrder = await Order.findById(orderId).populate("orderItems.item");
      if (populatedOrder) {
        const orderObj = populatedOrder.toObject();
        const dynamicPopulatedItem = orderObj.orderItems.find((i: any) => i.item?._id.toString() === itemId);

        if (dynamicPopulatedItem) {
          const itemPayload = { ...dynamicPopulatedItem, claim: item.claim };
          sendClaimAlertToAdmin(order._id.toString(), itemPayload, reason).catch((err) =>
            console.error("❌ [Email Trigger Failed] Event: ClaimAlertAdmin, Error:", err?.message || err)
          );
          sendClaimAlertToNursery(dynamicPopulatedItem.nursery.toString(), order._id.toString(), itemPayload).catch((err) =>
            console.error("❌ [Email Trigger Failed] Event: ClaimAlertNursery, Error:", err?.message || err)
          );
        }
      }
    } catch (err) {
      console.error("Background notifications layer crashed:", err);
    }
  }
);