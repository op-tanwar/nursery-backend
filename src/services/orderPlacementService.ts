import * as crypto from "node:crypto";
import mongoose, { ClientSession } from "mongoose";
import Order from "../models/orderModel";
import User from "../models/userModel";
import NurseryProfile from "../models/nurseryProfileModel";
import StockReservation from "../models/stockReservationModel";
import TransactionLedger from "../models/transactionLedgerModel";
import Coupon from "../models/couponModel";
import ErrorHandler from "../utils/errorHandler";
import { getRazorpayInstance } from "./razorpay";
import { commitStockReservation } from "./stockReservationService";
import { processFallbackRefund } from "./fallbackRefundService";
import { checkCartAvailability } from "../controllers/cartController";
import { verifyCouponInternal } from "../controllers/couponController";
import { checkCartItemsPincodeServiceability } from "../utils/pincodeService";
import Product from "../models/productModel";
import {
  getCaseInsensitiveModel,
  resolveProductAndModel,
} from "../utils/productRegistry";
import {
  getEffectivePrice,
  calculateAuthoritativeTotals,
  toPaise,
  toRupees,
} from "../utils/pricingUtils";
import { calcLineGross, roundMoney } from "../utils/financialUtils";
import { getActiveTaxMap } from "../utils/taxService";
import { getEffectiveCommission } from "../utils/commissionService";
import { withTransaction } from "../utils/transactionHelper";
import {
  sendOrderConfirmationEmail,
  sendNurseryOrderAlertEmail,
  sendAdminNewOrderEmail,
} from "../utils/orderEmailService";
import { sendLowStockAlert } from "../templates/emails";
import { IOrder } from "../types/order.types";

export interface CalculatedOrderTotals {
  calculatedItems: any[];
  subtotal: number;
  discount: number;
  finalAmount: number;
  expectedAmountPaise: number;
  authoritativeTotals: any;
  dbProductsCache: Array<{ dbProduct: any; modelName: string; quantity: number }>;
  appliedCouponCode?: string;
  couponDiscountAmount: number;
}

export interface CreateOrderRecordData {
  shippingInfo: any;
  orderItems: any[];
  user: any;
  paymentInfo: {
    id: string;
    orderId: string;
    status: string;
  };
  itemsPrice: number;
  taxPrice: number;
  shippingPrice: number;
  couponCode?: string;
  discountAmount?: number;
  totalPrice: number;
  paidAt?: Date;
}

export interface ProcessOrderPlacementParams {
  paymentInfo: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  };
  shippingInfo: any;
  orderItems: any[];
  couponCode?: string;
  coupon?: string;
  user: any;
  shippingAddress?: any;
  pincode?: string;
  pinCode?: string;
}

export type OrderPlacementResult =
  | {
      status: "EXISTING";
      order: any;
    }
  | {
      status: "UNSERVICEABLE";
      unserviceableItems: any[];
    }
  | {
      status: "COLLISION_REFUNDED";
      refunded: boolean;
      refundId?: string;
      message: string;
    }
  | {
      status: "SUCCESS";
      order: any;
    };

/**
 * 🔒 1. CRYPTOGRAPHIC PAYMENT SIGNATURE VERIFICATION
 */
export const verifyPaymentSignature = (
  orderId: string,
  paymentId: string,
  signature: string
): boolean => {
  if (!orderId || !paymentId || !signature) {
    return false;
  }
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    throw new ErrorHandler(
      "Server configuration error: Payment secret key uninitialized.",
      500
    );
  }
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const bufferExpected = Buffer.from(expectedSignature, "utf-8");
  const bufferReceived = Buffer.from(signature, "utf-8");

  if (bufferExpected.length !== bufferReceived.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufferExpected, bufferReceived);
};

/**
 * 🔒 2. SERVER-SIDE AUTHORITATIVE PRICE & DISCOUNT RECALCULATION
 */
export const calculateAndVerifyOrderTotals = async (
  items: any[],
  couponCode?: string,
  userId?: any
): Promise<CalculatedOrderTotals> => {
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ErrorHandler("Order items list is empty or invalid.", 400);
  }

  const taxMap = await getActiveTaxMap();
  const authoritativePriceItems: Array<{
    price: number;
    discountPrice?: number;
    quantity: number;
    itemModel?: string;
    category?: string;
  }> = [];
  const dbProductsCache: Array<{ dbProduct: any; modelName: string; quantity: number }> = [];

  for (const item of items) {
    const targetId = item.productId || item.item || item.id || item._id;
    const quantity = Math.max(1, Number(item.quantity) || 1);

    const dbProduct = await Product.findById(targetId);
    const modelName = "Product";

    if (!dbProduct) {
      throw new ErrorHandler(`Product reference not found: ${targetId}`, 404);
    }

    if (dbProduct.isActive === false) {
      throw new ErrorHandler(
        `Product "${dbProduct.name}" is no longer active for commerce.`,
        400
      );
    }

    if (dbProduct.nursery) {
      const nurseryProfile = await NurseryProfile.findOne({
        nursery: dbProduct.nursery,
      }).lean();
      if (nurseryProfile && !nurseryProfile.isActive) {
        throw new ErrorHandler(
          `Product "${dbProduct.name}" is unavailable because the nursery is temporarily suspended.`,
          400
        );
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

  const authoritativeTotals = calculateAuthoritativeTotals(
    authoritativePriceItems,
    taxMap
  );

  let appliedCouponCode: string | undefined;
  let couponDiscountAmount = 0;

  if (couponCode && typeof couponCode === "string" && couponCode.trim()) {
    try {
      const verifiedCoupon = await verifyCouponInternal(
        couponCode,
        authoritativeTotals.itemsPrice,
        userId
      );
      appliedCouponCode = verifiedCoupon.couponCode;
      couponDiscountAmount = verifiedCoupon.discountAmount;
    } catch (couponErr: any) {
      console.error(
        "🚨 [Coupon Verification Failed in OrderPlacementService]:",
        couponErr.message || couponErr
      );
      throw couponErr;
    }
  }

  const couponDiscountPaise = toPaise(couponDiscountAmount);
  const expectedAmountPaise = Math.max(
    100,
    Math.round(authoritativeTotals.totalPricePaise - couponDiscountPaise)
  );

  const calculatedItems: any[] = [];
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

    calculatedItems.push({
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

  return {
    calculatedItems,
    subtotal: authoritativeTotals.itemsPrice,
    discount: couponDiscountAmount,
    finalAmount: toRupees(expectedAmountPaise),
    expectedAmountPaise,
    authoritativeTotals,
    dbProductsCache,
    appliedCouponCode,
    couponDiscountAmount,
  };
};

/**
 * 🔒 3. INVENTORY CHECK, RESERVATION COMMIT, OR ATOMIC DECREMENT
 */
export const deductInventory = async (
  session?: ClientSession | null,
  items: any[] = [],
  razorpayOrderId?: string,
  isReservationPending: boolean = false
): Promise<{ lowStockAlertItems: Array<{ nurseryId?: string; name: string; stock: number }> }> => {
  const lowStockAlertItems: Array<{ nurseryId?: string; name: string; stock: number }> = [];
  const updateOpts = session ? { session } : {};

  if (isReservationPending && razorpayOrderId) {
    // 🔒 PATH A: Active 15-minute reservation held — commit stock deduction atomically
    const commitRes = await commitStockReservation(razorpayOrderId, session || undefined);
    if (!commitRes.success && commitRes.status !== "ALREADY_COMMITTED") {
      throw new Error(`Failed to commit stock reservation for order: ${razorpayOrderId}`);
    }

    for (const item of items) {
      const productDoc = await Product.findById(item.item).session(session || null);
      if (productDoc && typeof productDoc.stock === "number" && productDoc.stock <= 5) {
        lowStockAlertItems.push({
          nurseryId: item.nursery?.toString(),
          name: productDoc.name || "Product",
          stock: productDoc.stock,
        });
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

    for (const item of items) {
      const targetItemId = new mongoose.Types.ObjectId(item.item);

      const updatedStock = await Product.findOneAndUpdate(
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

      if (!updatedStock) {
        stockAllocationFailed = true;
        failedItemDetail = item;
        break;
      }

      successfullyDeducted.push({
        model: Product,
        id: targetItemId,
        quantity: Number(item.quantity),
      });

      if (typeof updatedStock.stock === "number" && updatedStock.stock <= 5) {
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

  return { lowStockAlertItems };
};

/**
 * 🔒 4. ORDER RECORD CREATION, COUPON USAGE INCREMENT & LEDGER ACCOUNTING
 */
export const createOrderRecord = async (
  session: ClientSession | null | undefined,
  orderData: CreateOrderRecordData
): Promise<IOrder> => {
  const createOpts = session ? { session } : {};
  const updateOpts = session ? { session } : {};

  const [newOrder] = await Order.create(
    [
      {
        shippingInfo: orderData.shippingInfo,
        orderItems: orderData.orderItems,
        user: orderData.user,
        paymentInfo: orderData.paymentInfo,
        itemsPrice: orderData.itemsPrice,
        taxPrice: orderData.taxPrice,
        shippingPrice: orderData.shippingPrice,
        couponCode: orderData.couponCode || undefined,
        discountAmount: orderData.discountAmount || 0,
        totalPrice: orderData.totalPrice,
        paidAt: orderData.paidAt || new Date(),
      },
    ],
    createOpts
  );

  // 🎟️ Atomically increment coupon usage and record user redemption
  if (orderData.couponCode && (orderData.discountAmount || 0) > 0) {
    await Coupon.updateOne(
      { code: orderData.couponCode },
      {
        $inc: { usedCount: 1 },
        $addToSet: { usedBy: orderData.user },
      },
      updateOpts
    );
  }

  // 📒 Ledger accounting entries for multi-vendor commissions
  const ledgerEntries = orderData.orderItems.map((item) => ({
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

  return newOrder;
};

/**
 * 📧 5. ASYNCHRONOUS NOTIFICATIONS (CUSTOMER, ADMIN, NURSERIES & LOW STOCK)
 */
export const sendOrderNotifications = async (
  order: any,
  lowStockAlertItems: Array<{ nurseryId?: string; name: string; stock: number }> = [],
  user?: any
): Promise<void> => {
  if (!order) return;
  try {
    const oid = order._id.toString();

    sendOrderConfirmationEmail(oid).catch((e) =>
      console.error(
        "❌ [Email Trigger Failed] Event: OrderConfirmation, Error:",
        e?.message || e
      )
    );

    sendAdminNewOrderEmail(
      oid,
      order.totalPrice,
      user?.name || "Customer",
      order.orderItems?.length || 0
    ).catch((e) =>
      console.error(
        "❌ [Email Trigger Failed] Event: AdminNewOrder, Error:",
        e?.message || e
      )
    );

    const nurseryMap = new Map<string, any[]>();
    for (const item of order.orderItems || []) {
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
        order.shippingInfo?.city,
        order.shippingInfo?.pinCode
      ).catch((e) =>
        console.error(
          "❌ [Email Trigger Failed] Event: NurseryOrderAlert, Error:",
          e?.message || e
        )
      );
    }

    if (lowStockAlertItems && lowStockAlertItems.length > 0) {
      (async () => {
        for (const lItem of lowStockAlertItems) {
          if (!lItem.nurseryId) continue;
          try {
            const vendor = await User.findById(lItem.nurseryId)
              .select("name email")
              .lean();
            if (vendor?.email) {
              sendLowStockAlert(
                vendor.email,
                (vendor as any).name || "Nursery Owner",
                lItem.name,
                lItem.stock
              ).catch((err) =>
                console.error(
                  "❌ [Email Trigger Failed] Event: LowStockAlert, Error:",
                  err?.message
                )
              );
            }
          } catch (err: any) {
            console.error(
              "Error looking up vendor for low stock alert:",
              err?.message
            );
          }
        }
      })().catch((err) =>
        console.error("Error in low stock background dispatch:", err)
      );
    }
  } catch (err: any) {
    console.error("❌ [sendOrderNotifications Failed]:", err?.message || err);
  }
};

/**
 * ⚡ 6. ORCHESTRATOR: COMPLETE END-TO-END ATOMIC ORDER PLACEMENT
 */
export const processOrderPlacement = async (
  params: ProcessOrderPlacementParams
): Promise<OrderPlacementResult> => {
  const {
    paymentInfo,
    shippingInfo,
    orderItems,
    couponCode,
    coupon,
    user,
    shippingAddress,
    pincode,
    pinCode,
  } = params;

  if (
    !paymentInfo ||
    !paymentInfo.razorpay_order_id ||
    !paymentInfo.razorpay_payment_id ||
    !paymentInfo.razorpay_signature
  ) {
    throw new ErrorHandler(
      "Cryptographic payment credentials (order_id, payment_id, signature) are required.",
      400
    );
  }

  if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
    throw new ErrorHandler("Order items array is required.", 400);
  }

  // 🛡️ CHECKOUT GUARD: Ensure customer's cart does not contain unavailable items
  if (user?._id) {
    const cartCheck = await checkCartAvailability(user._id);
    if (!cartCheck.isValid) {
      const itemNames = cartCheck.unavailableItems.map((u) => `"${u.name}"`).join(", ");
      throw new ErrorHandler(
        `Your cart contains unavailable item(s): ${itemNames}. Please remove or save these items for later before placing an order.`,
        400
      );
    }
  }

  // 🔒 1. CRYPTOGRAPHIC SIGNATURE VERIFICATION
  const isSignatureValid = verifyPaymentSignature(
    paymentInfo.razorpay_order_id,
    paymentInfo.razorpay_payment_id,
    paymentInfo.razorpay_signature
  );
  if (!isSignatureValid) {
    throw new ErrorHandler(
      "Payment signature verification failed. Untrusted or tampered transaction credentials.",
      400
    );
  }

  // 🔒 2. VERIFY GATEWAY ORDER RECORD
  const razorpay = getRazorpayInstance();
  let rzpOrder: any;
  try {
    rzpOrder = await razorpay.orders.fetch(paymentInfo.razorpay_order_id);
  } catch (err: any) {
    throw new ErrorHandler(
      `Failed to fetch order from payment gateway: ${err.message}`,
      400
    );
  }

  // 🔒 3. RECALCULATE AUTHORITATIVE PRICES FRESHLY FROM MONGODB & VERIFY COUPON
  const rawCoupon = couponCode || coupon || rzpOrder.notes?.couponCode;
  const totals = await calculateAndVerifyOrderTotals(
    orderItems,
    rawCoupon,
    user?._id
  );

  // ⚡ INTERCEPT AMOUNT MANIPULATION
  const chargedAmountPaise = Number(rzpOrder.amount);
  if (chargedAmountPaise < totals.expectedAmountPaise) {
    console.error(
      `🚨 [Security Alert] Underpayment detected! Catalog & Coupon require ₹${toRupees(
        totals.expectedAmountPaise
      )} (${totals.expectedAmountPaise} paise), but gateway was charged ₹${
        chargedAmountPaise / 100
      } (${chargedAmountPaise} paise). User: ${user?._id}`
    );
    throw new ErrorHandler(
      `Payment amount mismatch! Expected ₹${toRupees(
        totals.expectedAmountPaise
      )} (${totals.expectedAmountPaise} paise), but gateway was charged ₹${
        chargedAmountPaise / 100
      } (${chargedAmountPaise} paise).`,
      400
    );
  }

  if (chargedAmountPaise > totals.expectedAmountPaise) {
    console.warn(
      `⚠️ [Payment Audit] Gateway charged ₹${chargedAmountPaise / 100} (${chargedAmountPaise} paise) while current catalog total with coupon is ₹${toRupees(
        totals.expectedAmountPaise
      )} (${totals.expectedAmountPaise} paise). Permitting order verification to preserve customer funds.`
    );
  }

  // 🛡️ 4. IDEMPOTENCY CHECK
  const existingOrder = await Order.findOne({
    "paymentInfo.id": paymentInfo.razorpay_payment_id,
  });
  if (existingOrder) {
    return {
      status: "EXISTING",
      order: existingOrder,
    };
  }

  // 🚚 PINCODE SERVICEABILITY VALIDATION ACROSS MULTI-VENDOR ITEMS
  const rawDestinationPincode =
    shippingInfo?.pinCode ||
    shippingInfo?.pincode ||
    shippingAddress?.pinCode ||
    shippingAddress?.pincode ||
    pincode ||
    pinCode;

  const destinationPincode = rawDestinationPincode
    ? String(rawDestinationPincode).trim()
    : "";

  const uniqueNurseryIds = Array.from(
    new Set(
      totals.dbProductsCache
        .map((entry) => entry.dbProduct.nursery?.toString())
        .filter((id): id is string => Boolean(id))
    )
  );

  if (uniqueNurseryIds.length > 0) {
    if (!destinationPincode || !/^[1-9][0-9]{5}$/.test(destinationPincode)) {
      throw new ErrorHandler(
        "A valid 6-digit shipping pincode is required to verify delivery serviceability.",
        400
      );
    }

    const nurseryProfiles = await NurseryProfile.find({
      $or: [
        { _id: { $in: uniqueNurseryIds as any } },
        { nursery: { $in: uniqueNurseryIds as any } },
      ],
    }).lean();

    const profileMap = new Map<string, any>();
    for (const p of nurseryProfiles) {
      if (p._id) {
        profileMap.set(p._id.toString(), p);
      }
      if (p.nursery) {
        profileMap.set(p.nursery.toString(), p);
      }
    }

    const itemsToCheck = totals.dbProductsCache.map((entry) => ({
      productId: String(entry.dbProduct._id),
      productName: entry.dbProduct.name,
      nurseryId: entry.dbProduct.nursery ? entry.dbProduct.nursery.toString() : null,
    }));

    const serviceability = await checkCartItemsPincodeServiceability(
      destinationPincode,
      itemsToCheck,
      profileMap
    );

    if (!serviceability.isServiceable) {
      return {
        status: "UNSERVICEABLE",
        unserviceableItems: serviceability.unserviceableItems,
      };
    }
  }

  // 🔍 5. STOCK RESERVATION STATUS EVALUATION
  const reservation = await StockReservation.findOne({
    razorpayOrderId: paymentInfo.razorpay_order_id,
  });

  const isReservationPending = Boolean(reservation && reservation.status === "PENDING");

  // 🔒 6. ATOMIC INVENTORY REDUCTION & ORDER CREATION
  let savedOrder: any = null;
  let lowStockAlertItems: Array<{ nurseryId?: string; name: string; stock: number }> = [];

  try {
    await withTransaction(async (session) => {
      const deductResult = await deductInventory(
        session,
        totals.calculatedItems,
        paymentInfo.razorpay_order_id,
        isReservationPending
      );
      lowStockAlertItems = deductResult.lowStockAlertItems;

      savedOrder = await createOrderRecord(session, {
        shippingInfo,
        orderItems: totals.calculatedItems,
        user: user?._id || user,
        paymentInfo: {
          id: paymentInfo.razorpay_payment_id,
          orderId: paymentInfo.razorpay_order_id,
          status: "captured",
        },
        itemsPrice: totals.authoritativeTotals.itemsPrice,
        taxPrice: totals.authoritativeTotals.taxPrice,
        shippingPrice: totals.authoritativeTotals.shippingPrice,
        couponCode: totals.appliedCouponCode,
        discountAmount: totals.couponDiscountAmount,
        totalPrice:
          chargedAmountPaise > totals.expectedAmountPaise
            ? toRupees(chargedAmountPaise)
            : toRupees(totals.expectedAmountPaise),
        paidAt: new Date(),
      });
    });
  } catch (err: any) {
    if (err?.isStockDepletedPostTtl) {
      const refundResult = await processFallbackRefund({
        razorpayPaymentId: paymentInfo.razorpay_payment_id,
        razorpayOrderId: paymentInfo.razorpay_order_id,
        amountPaise: chargedAmountPaise,
        userId: user?._id,
        customerEmail: user?.email,
        customerName: user?.name,
        reason: "STOCK_COLLISION_POST_TTL",
        orderItems: totals.calculatedItems,
      });

      return {
        status: "COLLISION_REFUNDED",
        refunded: refundResult.success,
        refundId: refundResult.refundId,
        message:
          "Item(s) in your cart were sold out because the 15-minute checkout reservation expired. A 100% full refund has been automatically initiated to your original payment method.",
      };
    }
    throw err;
  }

  // 📧 Fire-and-forget notifications
  if (savedOrder) {
    sendOrderNotifications(savedOrder, lowStockAlertItems, user).catch((e) =>
      console.error("Non-blocking background notification dispatch error:", e)
    );
  }

  return {
    status: "SUCCESS",
    order: savedOrder,
  };
};

export const OrderPlacementService = {
  verifyPaymentSignature,
  calculateAndVerifyOrderTotals,
  deductInventory,
  createOrderRecord,
  sendOrderNotifications,
  processOrderPlacement,
};

export default OrderPlacementService;
