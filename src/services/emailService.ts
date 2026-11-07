import mongoose from "mongoose";
import Order from "../models/orderModel";
import User from "../models/userModel";
import ClaimRequest from "../models/ClaimRequest";
import NurseryProfile from "../models/nurseryProfileModel";
import sendEmail, { getEmailConfig, EmailResult } from "../utils/sendEmail";
// Import productRegistry to guarantee all catalog schemas (Plant, Pot, Accessory, etc.)
// are registered in Mongoose memory before dynamic refPath populations occur
import "../models/productModel";
import {
  getAccountWelcomeHtml,
  getPasswordResetHtml,
  getPasswordChangedAlertHtml,
  getOrderConfirmationHtml,
  getOrderStatusUpdateHtml,
  getRefundInitiatedHtml,
  getReturnRequestCustomerHtml,
  getReturnReplacementCustomerDecisionHtml,
  getReturnReplacementNurseryActionHtml,
  getReturnReplacementAdminAuditHtml,
  getNurseryNewOrderAlertHtml,
  getNurseryOrderCancelledAlertHtml,
  getNurseryReturnAlertHtml,
  getLowStockAlertHtml,
  getVendorPayoutUpdateHtml,
  getAdminNewOrderAlertHtml,
  getAdminStockCollisionAlertHtml,
  getAdminReturnDisputeAlertHtml,
  getAdminHighValueOrderAlertHtml,
  BulkOrderEmailData,
  getAdminBulkOrderNotificationHtml,
  getBulkOrderReceivedHtml,
} from "../templates/emails";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const BRAND_NAME = process.env.APP_NAME || "Urban Nursery";

// ======================================================================
// 1. CUSTOMER: ACCOUNT REGISTRATION & SECURITY
// ======================================================================

/**
 * Sends branded, responsive welcome email upon customer registration.
 * Supports both { email, name } object and legacy (name, email) signature.
 */
export const sendWelcomeEmail = async (
  userOrName: { email: string; name: string } | string,
  userEmail?: string
): Promise<void> => {
  try {
    let name = "Plant Lover";
    let email = "";

    if (typeof userOrName === "object" && userOrName !== null) {
      name = userOrName.name || "Plant Lover";
      email = userOrName.email || "";
    } else if (typeof userOrName === "string") {
      if (userEmail) {
        if (userOrName.includes("@")) {
          email = userOrName;
          name = userEmail;
        } else {
          name = userOrName;
          email = userEmail;
        }
      } else {
        email = userOrName;
      }
    }

    if (!email) {
      console.error("[EMAIL ERROR] Type: WELCOME_ACCOUNT | Error: Missing recipient email");
      return;
    }

    const html = getAccountWelcomeHtml(name, email);
    await sendEmail({
      email,
      subject: `Welcome to ${BRAND_NAME}! 🌿 India's Pure Botanical Sanctuary`,
      message: `Hi ${name}, welcome to ${BRAND_NAME}! Your account is active and verified.`,
      html,
      type: "WELCOME_ACCOUNT",
    });
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: WELCOME_ACCOUNT | Error:", error?.message || error);
  }
};

/**
 * Sends secure password reset link to user.
 * Supports both { email, name, resetUrl, otp } object and legacy (email, name, resetUrl) signature.
 * Returns raw EmailResult so controller can verify delivery and roll back reset token if SMTP fails.
 */
export const sendPasswordResetEmail = async (
  userOrEmail: { email: string; name: string; resetUrl: string; otp?: string } | string,
  userNameOrResetUrl?: string,
  resetUrlParam?: string
): Promise<EmailResult> => {
  try {
    let email = "";
    let name = "Valued Customer";
    let resetUrl = "";
    let otp: string | undefined;

    if (typeof userOrEmail === "object" && userOrEmail !== null) {
      email = userOrEmail.email;
      name = userOrEmail.name || "Valued Customer";
      resetUrl = userOrEmail.resetUrl || "";
      otp = userOrEmail.otp;
    } else if (typeof userOrEmail === "string") {
      email = userOrEmail;
      name = userNameOrResetUrl || "Valued Customer";
      resetUrl = resetUrlParam || "";
    }

    if (!email) {
      return { success: false, error: "Missing recipient email" };
    }

    const html = getPasswordResetHtml(name, resetUrl, 15);
    const message = otp
      ? `Hi ${name}, your password reset OTP is ${otp}. Alternatively, reset using this link (valid for 15 minutes): ${resetUrl}\n\nIf you did not request this, please ignore.`
      : `Hi ${name}, reset your password using this link (valid for 15 minutes): ${resetUrl}\n\nIf you did not request this, please ignore.`;

    return await sendEmail({
      email,
      subject: `Reset Your ${BRAND_NAME} Password`,
      message,
      html,
      type: "PASSWORD_RESET",
    });
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: PASSWORD_RESET | Error:", error?.message || error);
    return {
      success: false,
      error: error?.message || "Failed to dispatch password reset email",
      code: error?.code,
      response: error?.response,
      command: error?.command,
    };
  }
};

/**
 * Backwards compatible alias for password reset email
 */
export const sendForgotPasswordEmail = sendPasswordResetEmail;

/**
 * Sends security alert immediately when account password is modified.
 */
export const sendPasswordChangedAlert = async (
  userEmail: string,
  userName: string
): Promise<void> => {
  try {
    const html = getPasswordChangedAlertHtml(userName, userEmail);
    await sendEmail({
      email: userEmail,
      subject: `🔒 Security Alert: Your ${BRAND_NAME} Password Was Changed`,
      message: `Hi ${userName}, your account password was successfully updated. If this wasn't you, please contact support immediately.`,
      html,
      type: "PASSWORD_CHANGED",
    });
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: PASSWORD_CHANGED | Error:", error?.message || error);
  }
};

// ======================================================================
// 2. CUSTOMER: ORDER CONFIRMATION & PROGRESSION
// ======================================================================

/**
 * Sends comprehensive order confirmation email with line items, fulfilling nursery names,
 * payment method, tax break-up, shipping address, and estimated delivery window.
 * Supports passing order ID string or populated Order document.
 */
export const sendOrderConfirmationEmail = async (
  orderOrId: any,
  userDoc?: any
): Promise<void> => {
  const orderId = typeof orderOrId === "string" ? orderOrId : orderOrId?._id?.toString();
  try {
    let order = orderOrId;

    if (typeof orderOrId === "string" || !orderOrId?.orderItems) {
      order = await Order.findById(orderOrId)
        .populate("user", "name email")
        .populate("orderItems.item", "name price")
        .populate("orderItems.nursery", "name businessName email")
        .lean();
    }

    if (!order) {
      console.error(`[EMAIL ERROR] Type: ORDER_CONFIRMATION | Error: Order ${orderId} not found.`);
      return;
    }

    const user = userDoc || order.user;
    const userEmail = user?.email;
    const userName = user?.name || "Plant Lover";

    if (!userEmail) {
      console.error(`[EMAIL ERROR] Type: ORDER_CONFIRMATION | Error: User email missing on order ${orderId}`);
      return;
    }

    const html = getOrderConfirmationHtml(order, { name: userName, email: userEmail });

    await sendEmail({
      email: userEmail,
      subject: `Order Confirmed #${order._id} — Thank You from ${BRAND_NAME} 🌿`,
      message: `Hi ${userName}, your order #${order._id} has been placed successfully. Grand Total: ₹${Number(order.totalPrice || 0).toFixed(2)}`,
      html,
      type: "ORDER_CONFIRMATION",
    });
  } catch (error: any) {
    console.error(`[EMAIL ERROR] Type: ORDER_CONFIRMATION | Order: ${orderId} | Error:`, error?.message || error);
  }
};

/**
 * Sends order status update email (Dispatched, Shipped, In Transit, Out for Delivery, Delivered, Cancelled).
 * Supports passing order ID string or populated Order document.
 */
export const sendOrderStatusUpdateEmail = async (
  orderOrId: any,
  status: string,
  details?: {
    trackingCourier?: string;
    trackingId?: string;
    trackingUrl?: string;
    reason?: string;
    refundId?: string;
    refundAmount?: number;
  }
): Promise<void> => {
  const orderId = typeof orderOrId === "string" ? orderOrId : orderOrId?._id?.toString();
  try {
    let order = orderOrId;

    if (typeof orderOrId === "string" || !orderOrId?.user) {
      order = await Order.findById(orderOrId)
        .populate("user", "name email")
        .lean();
    }

    if (!order || !order.user) {
      console.error(`[EMAIL ERROR] Type: ORDER_STATUS_${status} | Error: Order or User not found for ${orderId}`);
      return;
    }

    const user = order.user as any;
    if (!user.email) return;

    const html = getOrderStatusUpdateHtml(
      order,
      { name: user.name || "Customer", email: user.email },
      status,
      details
    );

    const typeKey = `ORDER_STATUS_${status.toUpperCase().replace(/\s+/g, "_")}`;

    await sendEmail({
      email: user.email,
      subject: `Order #${order._id} Status: ${status} — ${BRAND_NAME}`,
      message: `Hi ${user.name}, your order #${order._id} status is now: ${status}.`,
      html,
      type: typeKey,
    });
  } catch (error: any) {
    console.error(`[EMAIL ERROR] Type: ORDER_STATUS_${status} | Order: ${orderId} | Error:`, error?.message || error);
  }
};

/**
 * Standard alias for order status progression
 */
export const sendOrderStatusProgressionEmail = sendOrderStatusUpdateEmail;

export const sendOrderShippedEmail = async (
  orderId: string,
  details?: { trackingCourier?: string; trackingId?: string; trackingUrl?: string }
): Promise<void> => {
  return sendOrderStatusProgressionEmail(orderId, "Shipped", details);
};

export const sendOrderDeliveredEmail = async (orderId: string): Promise<void> => {
  return sendOrderStatusProgressionEmail(orderId, "Delivered");
};

/**
 * Sends post-delivery plant care & review feedback request email.
 */
export const sendReviewRequestEmail = async (orderId: string): Promise<void> => {
  try {
    const order = await Order.findById(orderId)
      .populate("user", "name email")
      .lean();

    if (!order || !order.user) return;
    const user = order.user as any;
    if (!user.email) return;

    const reviewUrl = `${FRONTEND_URL.replace(/\/+$/, "")}/orders/${order._id}`;

    const bodyHtml = `
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="background-color: #fef3c7; color: #b45309; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
          ⭐ Botanical Feedback
        </span>
        <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
          How are your new plants thriving?
        </h1>
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 auto; max-width: 480px;">
          Hi ${user.name}, your recent order <strong>#${order._id}</strong> arrived recently. Our nursery caretakers would love to hear your feedback on leaf health, potting, and delivery!
        </p>
      </div>

      <div style="text-align: center; margin: 28px 0;">
        <a href="${reviewUrl}" target="_blank" style="background-color: #15803d; color: #ffffff; padding: 14px 32px; font-size: 15px; font-weight: 700; text-decoration: none; border-radius: 10px; display: inline-block;">
          Share Your Plant Review &rarr;
        </a>
      </div>

      <p style="font-size: 13px; color: #94a3b8; text-align: center;">
        Your reviews directly support local verified nurseries and help fellow plant parents make the right choices.
      </p>
    `;

    const html = getOrderStatusUpdateHtml(order, { name: user.name, email: user.email }, "Delivered");

    await sendEmail({
      email: user.email,
      subject: `How are your greens doing? Review Order #${order._id} 🌿`,
      message: `Hi ${user.name}, please share your feedback on order #${order._id}: ${reviewUrl}`,
      html,
      type: "REVIEW_REQUEST",
    });
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: REVIEW_REQUEST | Error:", error?.message || error);
  }
};

/**
 * Handles complete order cancellation dispatches:
 * 1. Customer: cancellation confirmation + refund notice
 * 2. Nursery Owners: halt dispatch alerts
 * 3. Super Admin: order cancellation notification
 */
export const sendOrderCancellationEmails = async (
  orderId: string,
  reason?: string,
  refundId?: string,
  refundAmount?: number
): Promise<void> => {
  try {
    const order = await Order.findById(orderId)
      .populate("user", "name email")
      .populate("orderItems.item", "name")
      .populate("orderItems.nursery", "name email businessName")
      .lean();

    if (!order) return;

    // 1. Customer Notification
    if (order.user && (order.user as any).email) {
      const user = order.user as any;
      await sendOrderStatusProgressionEmail(orderId, "Cancelled", {
        reason: reason || "Cancelled by request",
        refundId,
        refundAmount: refundAmount || order.totalPrice,
      });
    }

    // 2. Nursery Alerts (Halt Packaging/Dispatch)
    const nurseryGroupMap = new Map<string, { nurseryUser: any; items: any[] }>();
    for (const item of order.orderItems) {
      const nid = item.nursery?._id?.toString() || item.nursery?.toString();
      if (nid) {
        if (!nurseryGroupMap.has(nid)) {
          nurseryGroupMap.set(nid, { nurseryUser: item.nursery, items: [] });
        }
        nurseryGroupMap.get(nid)!.items.push(item);
      }
    }

    for (const [nid, group] of nurseryGroupMap) {
      let vendorEmail = group.nurseryUser?.email;
      let vendorName = group.nurseryUser?.businessName || group.nurseryUser?.name || "Nursery Partner";

      if (!vendorEmail) {
        const u = await User.findById(nid).select("name email").lean();
        if (u) {
          vendorEmail = u.email;
          vendorName = u.name;
        }
      }

      if (vendorEmail) {
        const html = getNurseryOrderCancelledAlertHtml(vendorName, orderId, group.items, reason);
        await sendEmail({
          email: vendorEmail,
          subject: `🛑 [HALT DISPATCH] Order #${orderId} Cancelled — ${BRAND_NAME}`,
          message: `Attention ${vendorName}, Order #${orderId} was cancelled. Please halt dispatch.`,
          html,
          type: "NURSERY_ORDER_CANCELLED",
        });
      }
    }

    // 3. Super Admin Alert
    const config = getEmailConfig();
    if (config.adminEmail) {
      await sendEmail({
        email: config.adminEmail,
        subject: `❌ [Order Cancelled] Order #${orderId} (₹${order.totalPrice.toFixed(2)})`,
        message: `Order #${orderId} was cancelled. Total amount: ₹${order.totalPrice.toFixed(2)}. Reason: ${reason || "User/Admin action"}`,
        type: "ADMIN_ORDER_CANCELLED",
      });
    }
  } catch (error: any) {
    console.error(`[EMAIL ERROR] Type: ORDER_CANCELLATION | Order: ${orderId} | Error:`, error?.message || error);
  }
};

// ======================================================================
// 3. NURSERY OWNER (VENDOR) EMAIL ALERTS
// ======================================================================

/**
 * Sends new order alert to a fulfilling nursery with items, destination city/pincode, and 24h SLA.
 * Supports passing either a NurseryDocument or a string ID.
 */
export const sendNurseryNewOrderAlert = async (
  nursery: any,
  nurseryItems: any[],
  orderId: string,
  shippingInfo?: { city?: string; pinCode?: string }
): Promise<void> => {
  const nurseryId = typeof nursery === "string" ? nursery : (nursery?._id?.toString() || nursery?.nursery?.toString());
  try {
    let targetEmail = nursery?.businessEmail || nursery?.email;
    let vendorName = nursery?.businessName || nursery?.name;

    if (!targetEmail && nurseryId) {
      const [vendorUser, vendorProfile] = await Promise.all([
        User.findById(nurseryId).select("name email").lean(),
        NurseryProfile.findOne({ nursery: nurseryId }).select("businessName businessEmail").lean(),
      ]);
      targetEmail = vendorProfile?.businessEmail || vendorUser?.email;
      vendorName = vendorProfile?.businessName || vendorUser?.name || "Nursery Partner";
    }

    if (!targetEmail) {
      console.error(`[EMAIL ERROR] Type: NURSERY_NEW_ORDER | Error: Vendor [${nurseryId}] email not found.`);
      return;
    }

    const html = getNurseryNewOrderAlertHtml(
      vendorName || "Nursery Partner",
      orderId,
      nurseryItems,
      shippingInfo?.city || "Destination Hub",
      shippingInfo?.pinCode
    );

    await sendEmail({
      email: targetEmail,
      subject: `🚨 [NEW SALE] Order #${orderId} Received — Prepare for Dispatch (${BRAND_NAME})`,
      message: `Hi ${vendorName || "Nursery Partner"}, you have received a new customer order #${orderId} on ${BRAND_NAME}. Please prepare plants for dispatch within 24 hours.`,
      html,
      type: "NURSERY_NEW_ORDER",
    });
  } catch (error: any) {
    console.error(`[EMAIL ERROR] Type: NURSERY_NEW_ORDER | Nursery: ${nurseryId} | Error:`, error?.message || error);
  }
};

/**
 * Backwards compatible alias for sendNurseryNewOrderAlert
 */
export const sendNurseryNewOrderEmail = sendNurseryNewOrderAlert;

/**
 * Backwards compatible alias for orderController / paymentController
 */
export const sendNurseryOrderAlertEmail = async (
  nurseryId: string,
  orderId: string,
  nurseryItems: any[],
  shippingCity: string = "Destination Hub",
  shippingPinCode?: string
): Promise<void> => {
  return sendNurseryNewOrderAlert(nurseryId, nurseryItems, orderId, { city: shippingCity, pinCode: shippingPinCode });
};

/**
 * Sends low stock or out-of-stock inventory warning alert to nursery.
 */
export const sendLowStockAlert = async (
  nurseryEmail: string,
  nurseryName: string,
  productName: string,
  currentStock: number,
  threshold: number = 3
): Promise<void> => {
  try {
    const isOutOfStock = currentStock <= 0;
    const html = getLowStockAlertHtml(nurseryName, productName, currentStock, threshold);
    const typeKey = isOutOfStock ? "OUT_OF_STOCK" : "LOW_STOCK";

    await sendEmail({
      email: nurseryEmail,
      subject: isOutOfStock
        ? `🚨 [OUT OF STOCK] ${productName} — Restock Urgently (${BRAND_NAME})`
        : `⚠️ [LOW STOCK ALERT] ${productName} (${currentStock} Remaining)`,
      message: `${nurseryName}, stock for ${productName} is ${isOutOfStock ? "0" : currentStock}. Please update inventory on your dashboard.`,
      html,
      type: typeKey,
    });
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: LOW_STOCK | Error:", error?.message || error);
  }
};

/**
 * Sends payout status alert (Requested, Approved, Completed, Rejected) to nursery.
 */
export const sendPayoutStatusEmail = async (
  nurseryEmail: string,
  nurseryName: string,
  amount: number,
  status: "Requested" | "Approved" | "Completed" | "Rejected",
  payoutId?: string,
  note?: string
): Promise<void> => {
  try {
    const subjectMap: Record<string, string> = {
      Requested: `💰 Payout Request Received — ₹${amount.toFixed(2)}`,
      Approved:  `✅ Payout Approved — ₹${amount.toFixed(2)}`,
      Completed: `🎉 Payout Settled to Bank — ₹${amount.toFixed(2)}`,
      Rejected:  `❌ Payout Request Rejected — ₹${amount.toFixed(2)}`,
    };

    const html = getVendorPayoutUpdateHtml(nurseryName, amount, status, payoutId, note);

    await sendEmail({
      email: nurseryEmail,
      subject: subjectMap[status] || `Payout Update — ₹${amount.toFixed(2)} (${BRAND_NAME})`,
      message: `Hi ${nurseryName}, your payout of ₹${amount.toFixed(2)} is now ${status}.`,
      html,
      type: `PAYOUT_${status.toUpperCase()}`,
    });
  } catch (error: any) {
    console.error(`[EMAIL ERROR] Type: PAYOUT_${status} | Error:`, error?.message || error);
  }
};

/**
 * Sends payout notification alert to a fulfilling nursery partner.
 * Supports passing nursery document or nursery ID / email.
 */
export const sendNurseryPayoutNotification = async (
  nursery: any,
  payoutAmount: number,
  transactionId: string = "N/A",
  details?: { status?: "Requested" | "Approved" | "Completed" | "Rejected"; note?: string }
): Promise<void> => {
  try {
    let targetEmail = typeof nursery === "string" && nursery.includes("@") ? nursery : nursery?.businessEmail || nursery?.email;
    let vendorName = nursery?.businessName || nursery?.name || "Nursery Partner";

    if (!targetEmail && nursery) {
      const nid = typeof nursery === "string" ? nursery : (nursery._id?.toString() || nursery.nursery?.toString());
      if (nid) {
        const [vendorUser, vendorProfile] = await Promise.all([
          User.findById(nid).select("name email").lean(),
          NurseryProfile.findOne({ nursery: nid }).select("businessName businessEmail").lean(),
        ]);
        targetEmail = vendorProfile?.businessEmail || vendorUser?.email;
        vendorName = vendorProfile?.businessName || vendorUser?.name || "Nursery Partner";
      }
    }

    if (!targetEmail) {
      console.error("[EMAIL ERROR] Type: NURSERY_PAYOUT | Error: Target email not found for payout");
      return;
    }

    const status = details?.status || "Completed";
    const note = details?.note || `Transaction ID: ${transactionId}`;
    await sendPayoutStatusEmail(targetEmail, vendorName, payoutAmount, status, transactionId, note);
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: NURSERY_PAYOUT | Error:", error?.message || error);
  }
};

// ======================================================================
// 4. FALLBACK REFUNDS & STOCK ANOMALIES
// ======================================================================

/**
 * Sends customer refund confirmation receipt when automated fallback refund executes.
 */
export const sendFallbackRefundEmail = async (details: {
  customerEmail: string;
  customerName: string;
  orderId: string;
  amount: number;
  refundId?: string;
  reason: string;
}): Promise<void> => {
  try {
    const html = getRefundInitiatedHtml(
      details.customerName,
      details.orderId,
      details.amount,
      details.refundId
    );

    await sendEmail({
      email: details.customerEmail,
      subject: `100% Refund Initiated for Order #${details.orderId} — ${BRAND_NAME}`,
      message: `Hi ${details.customerName}, a refund of ₹${details.amount.toFixed(2)} has been initiated for order #${details.orderId}.`,
      html,
      type: "FALLBACK_REFUND",
    });
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: FALLBACK_REFUND | Error:", error?.message || error);
  }
};

/**
 * Sends immediate alert to Super Admin when stock collision post-TTL triggers auto-refund.
 */
export const sendAdminStockCollisionAlert = async (details: {
  orderId: string;
  paymentId: string;
  amount: number;
  customerName: string;
  customerEmail: string;
  refundId?: string;
  reason: string;
  items?: any[];
}): Promise<void> => {
  try {
    const config = getEmailConfig();
    if (!config.adminEmail) return;

    const html = getAdminStockCollisionAlertHtml(details);

    await sendEmail({
      email: config.adminEmail,
      subject: `🚨 [SYSTEM ANOMALY] Fallback Refund ₹${details.amount.toFixed(2)} for Order #${details.orderId}`,
      message: `Stock collision auto-refund executed for order #${details.orderId} (Payment ID: ${details.paymentId}, Refund ID: ${details.refundId || "N/A"}). Reason: ${details.reason}`,
      html,
      type: "ADMIN_STOCK_COLLISION",
    });
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: ADMIN_STOCK_COLLISION | Error:", error?.message || error);
  }
};

// ======================================================================
// 5. RETURNS, REPLACEMENTS & DISPUTES
// ======================================================================

/**
 * Triggered when customer files a Return / Replacement request.
 * Dispatches:
 * 1. Customer confirmation
 * 2. Nursery alert
 * 3. Super Admin dispute alert
 */
export const sendReturnRequestCreatedEmails = async (returnRequestId: string): Promise<void> => {
  try {
    const returnReq = await ClaimRequest.findById(returnRequestId)
      .populate("userId", "name email")
      .populate("nurseryId", "name businessName email")
      .populate("orderId", "orderStatus totalPrice")
      .lean();

    if (!returnReq) return;

    const customer = (returnReq.userId || (returnReq as any).user) as any;
    const nursery = (returnReq.nurseryId || (returnReq as any).nursery) as any;
    const orderId =
      returnReq.orderId?._id?.toString() ||
      (returnReq.orderId as any)?.toString() ||
      (returnReq as any).order?._id?.toString() ||
      "N/A";
    const proofUrl = returnReq.proofImages?.[0] || returnReq.images?.[0] || "#";

    // 1. Customer Confirmation Email
    if (customer?.email) {
      const customerHtml = getReturnRequestCustomerHtml(
        customer.name || "Customer",
        orderId,
        returnReq.requestType,
        returnReq.productName,
        returnReq.reason,
        "Pending"
      );

      sendEmail({
        email: customer.email,
        subject: `Your ${returnReq.requestType} Request for Order #${orderId} Has Been Received — ${BRAND_NAME}`,
        message: `Hi ${customer.name}, your ${returnReq.requestType} request for ${returnReq.productName} is being reviewed.`,
        html: customerHtml,
        type: "RETURN_REQUEST_RECEIVED",
      }).catch((e) => console.error("[EMAIL ERROR] Customer return confirmation:", e?.message));
    }

    // 2. Nursery Alert Email
    if (nursery?.email) {
      const nurseryHtml = getNurseryReturnAlertHtml(
        nursery.businessName || nursery.name || "Nursery Partner",
        orderId,
        returnReq.productName,
        returnReq.requestType,
        returnReq.reason,
        proofUrl
      );

      sendEmail({
        email: nursery.email,
        subject: `⚠️ [CUSTOMER CLAIM] ${returnReq.requestType} Requested for Order #${orderId} — ${returnReq.productName}`,
        message: `A customer requested ${returnReq.requestType} for ${returnReq.productName} on Order #${orderId}.`,
        html: nurseryHtml,
        type: "NURSERY_RETURN_ALERT",
      }).catch((e) => console.error("[EMAIL ERROR] Nursery return alert:", e?.message));
    }

    // 3. Super Admin Dispute Alert
    const config = getEmailConfig();
    if (config.adminEmail) {
      const adminHtml = getAdminReturnDisputeAlertHtml({
        returnId: returnReq._id.toString(),
        orderId,
        customerName: customer?.name || "Customer",
        customerEmail: customer?.email || "Unknown",
        nurseryName: nursery?.businessName || nursery?.name || "Nursery",
        productName: returnReq.productName,
        requestType: returnReq.requestType,
        reason: returnReq.reason,
        description: returnReq.description,
        proofUrl,
      });

      sendEmail({
        email: config.adminEmail,
        subject: `⚖️ [DISPUTE] ${returnReq.requestType} Raised for Order #${orderId} (${nursery?.businessName || nursery?.name || "Vendor"})`,
        message: `Customer ${customer?.name} raised a ${returnReq.requestType} claim for ${returnReq.productName} (Order #${orderId}).`,
        html: adminHtml,
        type: "ADMIN_RETURN_DISPUTE",
      }).catch((e) => console.error("[EMAIL ERROR] Admin dispute alert:", e?.message));
    }
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: RETURN_REQUEST_PIPELINE | Error:", error?.message || error);
  }
};

/**
 * Triggered when Super Admin resolves / updates Return Request status.
 * Dispatches status update to Customer.
 */
export const sendReturnRequestStatusUpdateEmail = async (returnRequestId: string): Promise<void> => {
  try {
    const returnReq = await ClaimRequest.findById(returnRequestId)
      .populate("userId", "name email")
      .lean();

    if (!returnReq) return;
    const customer = (returnReq.userId || (returnReq as any).user) as any;
    if (!customer?.email) return;

    const orderId =
      returnReq.orderId?._id?.toString() ||
      (returnReq.orderId as any)?.toString() ||
      (returnReq as any).order?.toString() ||
      "N/A";
    const html = getReturnRequestCustomerHtml(
      customer.name || "Customer",
      orderId,
      returnReq.requestType,
      returnReq.productName,
      returnReq.reason,
      returnReq.status,
      returnReq.adminComments
    );

    await sendEmail({
      email: customer.email,
      subject: `Update on Your ${returnReq.requestType} Request — Order #${orderId} (${returnReq.status})`,
      message: `Hi ${customer.name}, your ${returnReq.requestType} request for ${returnReq.productName} has been updated to "${returnReq.status}".`,
      html,
      type: "RETURN_STATUS_UPDATE",
    });
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: RETURN_STATUS_UPDATE | Error:", error?.message || error);
  }
};

/**
 * 🔄 3-WAY NOTIFICATION SYSTEM: Triggered when Admin approves, rejects or completes a Return / Replacement.
 * Concurrently dispatches:
 * 1. Customer: Decision details, next steps (pickup/delivery/refund/rejection), and admin remarks.
 * 2. Nursery Partner: Action instructions, packaging guidelines, order reference, customer destination.
 * 3. Central Admin: Internal audit log snapshot of the resolution.
 */
export const sendReturnReplacementStatusEmails = async (
  returnRequestId: string
): Promise<void> => {
  try {
    const returnReq = await ClaimRequest.findById(returnRequestId)
      .populate("userId", "name email phone")
      .populate("orderId", "orderStatus deliveredAt createdAt shippingInfo totalPrice")
      .populate("nurseryId", "name email");

    if (!returnReq) return;

    const customer = returnReq.userId as any;
    const order = returnReq.orderId as any;
    const nurseryUser = returnReq.nurseryId as any;

    const orderIdStr = order?._id ? order._id.toString() : String(returnReq.orderId || "N/A");
    const displayOrderId = orderIdStr.slice(-8).toUpperCase();
    const requestIdStr = returnReq._id.toString();

    // 1. Resolve Nursery business details & email
    let nurseryName = nurseryUser?.name || "Nursery Partner";
    let nurseryEmail = nurseryUser?.email || "";

    if (returnReq.nurseryId) {
      const nid = nurseryUser?._id || returnReq.nurseryId;
      const nurseryProfile = await NurseryProfile.findOne({ nursery: nid }).select(
        "businessName businessEmail businessPhone"
      );
      if (nurseryProfile) {
        if (nurseryProfile.businessName) nurseryName = nurseryProfile.businessName;
        if (nurseryProfile.businessEmail) nurseryEmail = nurseryProfile.businessEmail;
      }
    }

    const shippingCity = order?.shippingInfo?.city || "";
    const shippingState = order?.shippingInfo?.state || "";

    const emailPromises: Promise<any>[] = [];

    // ─────────────────────────────────────────────────────────────
    // 👤 A. CUSTOMER DECISION EMAIL
    // ─────────────────────────────────────────────────────────────
    if (customer?.email) {
      const customerHtml = getReturnReplacementCustomerDecisionHtml({
        customerName: customer.name || "Customer",
        orderId: displayOrderId,
        requestId: requestIdStr,
        requestType: returnReq.requestType,
        status: returnReq.status,
        productName: returnReq.productName,
        productImage: returnReq.productImage,
        reason: returnReq.reason,
        adminRemarks: returnReq.adminNotes,
      });

      emailPromises.push(
        sendEmail({
          email: customer.email,
          subject: `Update on your ${returnReq.requestType} Request - Order #${displayOrderId}`,
          message: `Hi ${customer.name}, your ${returnReq.requestType} request for ${returnReq.productName} has been ${returnReq.status.toLowerCase()}.`,
          html: customerHtml,
          type: "RETURN_STATUS_UPDATE",
        }).catch((err) =>
          console.error("[EMAIL ERROR] Customer decision email failed:", err?.message || err)
        )
      );
    }

    // ─────────────────────────────────────────────────────────────
    // 🏡 B. NURSERY PARTNER ACTION EMAIL
    // ─────────────────────────────────────────────────────────────
    if (nurseryEmail) {
      const nurseryHtml = getReturnReplacementNurseryActionHtml({
        nurseryName,
        orderId: displayOrderId,
        requestId: requestIdStr,
        requestType: returnReq.requestType,
        status: returnReq.status,
        productName: returnReq.productName,
        customerCity: shippingCity,
        customerState: shippingState,
        reason: returnReq.reason,
        description: returnReq.description,
        adminRemarks: returnReq.adminNotes,
      });

      emailPromises.push(
        sendEmail({
          email: nurseryEmail,
          subject: `[${returnReq.status === "Approved" ? "Action Required" : "Notice"}] ${returnReq.requestType} Request #${requestIdStr.slice(-6).toUpperCase()} for Order #${displayOrderId}`,
          message: `Claim #${requestIdStr.slice(-6).toUpperCase()} for Order #${displayOrderId} has been marked as "${returnReq.status}" by Admin.`,
          html: nurseryHtml,
          type: "NURSERY_RETURN_ALERT",
        }).catch((err) =>
          console.error("[EMAIL ERROR] Nursery action email failed:", err?.message || err)
        )
      );
    }

    // ─────────────────────────────────────────────────────────────
    // 🛡️ C. CENTRAL ADMIN LOG NOTIFICATION EMAIL
    // ─────────────────────────────────────────────────────────────
    const config = getEmailConfig();
    const adminEmail = process.env.ADMIN_ALERT_EMAIL || config.adminEmail || "admin@urbannursery.com";
    if (adminEmail) {
      const adminHtml = getReturnReplacementAdminAuditHtml({
        requestId: requestIdStr,
        orderId: displayOrderId,
        status: returnReq.status,
        requestType: returnReq.requestType,
        customerName: customer?.name || "Customer",
        customerEmail: customer?.email || "Unknown",
        nurseryName,
        productName: returnReq.productName,
        reason: returnReq.reason,
        adminRemarks: returnReq.adminNotes,
      });

      emailPromises.push(
        sendEmail({
          email: adminEmail,
          subject: `[Audit] Claim #${requestIdStr.slice(-6).toUpperCase()} marked as ${returnReq.status}`,
          message: `Claim #${requestIdStr.slice(-6).toUpperCase()} on Order #${displayOrderId} updated to ${returnReq.status}.`,
          html: adminHtml,
          type: "ADMIN_CLAIM_AUDIT",
        }).catch((err) =>
          console.error("[EMAIL ERROR] Admin audit email failed:", err?.message || err)
        )
      );
    }

    await Promise.allSettled(emailPromises);
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: RETURN_REPLACEMENT_3WAY_ALERT | Error:", error?.message || error);
  }
};

// ======================================================================
// 6. SUPER ADMIN SALES ALERTS (NEW SALES & HIGH-VALUE SALES)
// ======================================================================

/**
 * Dispatches new order sales alert to Super Admin, with automatic high-value check.
 */
export const sendAdminNewOrderEmail = async (
  orderId: string,
  totalPrice: number,
  customerName: string = "Customer",
  itemsCount: number = 1
): Promise<void> => {
  try {
    const config = getEmailConfig();
    if (!config.adminEmail) return;

    const html = getAdminNewOrderAlertHtml(orderId, totalPrice, customerName, itemsCount);

    await sendEmail({
      email: config.adminEmail,
      subject: `🛒 [NEW SALE] Order #${orderId} Placed (₹${totalPrice.toFixed(2)}) — ${BRAND_NAME}`,
      message: `A new order #${orderId} has been placed for ₹${totalPrice.toFixed(2)} by ${customerName}.`,
      html,
      type: "ADMIN_NEW_SALE",
    });

    // High-value check: alert if order >= ₹10,000
    if (totalPrice >= 10000) {
      await sendAdminHighValueOrderAlert(orderId, totalPrice, customerName, "", itemsCount);
    }
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: ADMIN_NEW_SALE | Error:", error?.message || error);
  }
};

/**
 * Dispatches dedicated high-value order alert to Super Admin.
 */
export const sendAdminHighValueOrderAlert = async (
  orderId: string,
  totalAmount: number,
  customerName: string,
  customerEmail: string,
  itemsCount: number
): Promise<void> => {
  try {
    const config = getEmailConfig();
    if (!config.adminEmail) return;

    const html = getAdminHighValueOrderAlertHtml(orderId, totalAmount, customerName, customerEmail, itemsCount);

    await sendEmail({
      email: config.adminEmail,
      subject: `💎 [HIGH-VALUE SALE] Order #${orderId} — ₹${totalAmount.toFixed(2)} (${BRAND_NAME})`,
      message: `High-value order #${orderId} of ₹${totalAmount.toFixed(2)} placed by ${customerName}.`,
      html,
      type: "ADMIN_HIGH_VALUE_SALE",
    });
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: ADMIN_HIGH_VALUE_SALE | Error:", error?.message || error);
  }
};

/**
 * Dispatches dedicated new vendor onboarding alert to Super Admin.
 */
export const sendAdminNewVendorAlert = async (nursery: any): Promise<void> => {
  try {
    const config = getEmailConfig();
    if (!config.adminEmail) return;

    const vendorName = nursery?.businessName || nursery?.name || "New Vendor";
    const vendorEmail = nursery?.businessEmail || nursery?.email || "N/A";
    const phone = nursery?.phone || nursery?.businessPhone || "N/A";
    const city = nursery?.city || nursery?.address?.city || "N/A";

    const bodyHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <span style="background-color: #fef3c7; color: #b45309; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
            🏡 New Vendor Onboarding
          </span>
          <h1 style="color: #0f172a; font-size: 22px; margin: 12px 0 6px 0;">New Nursery Partner Application</h1>
          <p style="color: #64748b; font-size: 14px; margin: 0;">A new nursery merchant has applied to sell on ${BRAND_NAME}</p>
        </div>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px; font-size: 14px; color: #334155;">
          <p style="margin: 0 0 6px 0;"><strong>Nursery Business:</strong> ${vendorName}</p>
          <p style="margin: 0 0 6px 0;"><strong>Contact Email:</strong> ${vendorEmail}</p>
          <p style="margin: 0 0 6px 0;"><strong>Phone:</strong> ${phone}</p>
          <p style="margin: 0;"><strong>City:</strong> ${city}</p>
        </div>
      </div>
    `;

    await sendEmail({
      email: config.adminEmail,
      subject: `🏡 [NEW VENDOR REGISTRATION] ${vendorName} (${city}) — ${BRAND_NAME}`,
      message: `A new nursery vendor has registered: ${vendorName} (${vendorEmail}, ${phone}, ${city}).`,
      html: bodyHtml,
      type: "ADMIN_NEW_VENDOR_ALERT",
    });
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: ADMIN_NEW_VENDOR_ALERT | Error:", error?.message || error);
  }
};

/**
 * Dispatches critical payment failure escalation alert to Super Admin.
 */
export const sendAdminCriticalPaymentFailureAlert = async (paymentDetails: {
  orderId?: string;
  paymentId?: string;
  amount?: number;
  reason?: string;
  error?: string;
  customerEmail?: string;
  customerName?: string;
  metadata?: any;
}): Promise<void> => {
  try {
    const config = getEmailConfig();
    if (!config.adminEmail) return;

    const bodyHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #fee2e2; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <span style="background-color: #fee2e2; color: #dc2626; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
            🚨 Critical Alert
          </span>
          <h1 style="color: #991b1b; font-size: 22px; margin: 12px 0 6px 0;">Payment Failure Escalation</h1>
          <p style="color: #64748b; font-size: 14px; margin: 0;">Payment transaction error requiring administrative review</p>
        </div>
        <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px; font-size: 14px; color: #7f1d1d;">
          <p style="margin: 0 0 6px 0;"><strong>Order ID:</strong> ${paymentDetails.orderId || "N/A"}</p>
          <p style="margin: 0 0 6px 0;"><strong>Payment ID:</strong> ${paymentDetails.paymentId || "N/A"}</p>
          <p style="margin: 0 0 6px 0;"><strong>Amount:</strong> ₹${paymentDetails.amount ? Number(paymentDetails.amount).toFixed(2) : "N/A"}</p>
          <p style="margin: 0 0 6px 0;"><strong>Customer:</strong> ${paymentDetails.customerName || "Customer"} (${paymentDetails.customerEmail || "N/A"})</p>
          <p style="margin: 0;"><strong>Failure Reason:</strong> ${paymentDetails.reason || paymentDetails.error || "Payment verification or capture failure"}</p>
        </div>
      </div>
    `;

    await sendEmail({
      email: config.adminEmail,
      subject: `🚨 [CRITICAL PAYMENT FAILURE] Order #${paymentDetails.orderId || "UNKNOWN"} — ₹${paymentDetails.amount || 0}`,
      message: `Critical payment failure for Order #${paymentDetails.orderId || "UNKNOWN"}. Payment ID: ${paymentDetails.paymentId || "N/A"}. Reason: ${paymentDetails.reason || paymentDetails.error || "N/A"}`,
      html: bodyHtml,
      type: "ADMIN_CRITICAL_PAYMENT_FAILURE",
    });
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: ADMIN_CRITICAL_PAYMENT_FAILURE | Error:", error?.message || error);
  }
};

export default {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendForgotPasswordEmail,
  sendPasswordChangedAlert,
  sendOrderConfirmationEmail,
  sendOrderStatusUpdateEmail,
  sendOrderStatusProgressionEmail,
  sendOrderShippedEmail,
  sendOrderDeliveredEmail,
  sendReviewRequestEmail,
  sendOrderCancellationEmails,
  sendNurseryNewOrderAlert,
  sendNurseryNewOrderEmail,
  sendNurseryOrderAlertEmail,
  sendLowStockAlert,
  sendNurseryPayoutNotification,
  sendPayoutStatusEmail,
  sendFallbackRefundEmail,
  sendAdminStockCollisionAlert,
  sendReturnRequestCreatedEmails,
  sendReturnRequestStatusUpdateEmail,
  sendReturnReplacementStatusEmails,
  sendAdminNewOrderEmail,
  sendAdminHighValueOrderAlert,
  sendAdminNewVendorAlert,
  sendAdminCriticalPaymentFailureAlert,
};
