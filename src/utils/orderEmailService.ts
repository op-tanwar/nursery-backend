/**
 * Re-export centralized email service for backward compatibility across controllers
 */
export {
  sendWelcomeEmail,
  sendForgotPasswordEmail,
  sendPasswordChangedAlert,
  sendOrderConfirmationEmail,
  sendOrderStatusProgressionEmail,
  sendOrderShippedEmail,
  sendOrderDeliveredEmail,
  sendReviewRequestEmail,
  sendOrderCancellationEmails,
  sendNurseryNewOrderEmail,
  sendNurseryOrderAlertEmail,
  sendLowStockAlert,
  sendPayoutStatusEmail,
  sendFallbackRefundEmail,
  sendAdminStockCollisionAlert,
  sendReturnRequestCreatedEmails,
  sendReturnRequestStatusUpdateEmail,
  sendAdminNewOrderEmail,
  sendAdminHighValueOrderAlert,
} from "../services/emailService";

// Backwards-compatible alias for order status updates
import { sendOrderStatusProgressionEmail } from "../services/emailService";
export const sendOrderStatusChangeEmail = async (orderId: string, newStatus: string): Promise<void> => {
  return sendOrderStatusProgressionEmail(orderId, newStatus);
};

// Legacy item claim alerts (used by requestItemClaim in orderController)
import sendEmail, { getEmailConfig } from "./sendEmail";
import User from "../models/userModel";

const BRAND_NAME = process.env.APP_NAME || "Urban Nursery";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

export const sendClaimAlertToAdmin = async (
  orderId: string,
  item: any,
  reason: string
): Promise<void> => {
  try {
    const config = getEmailConfig();
    const adminEmail = config.adminEmail;
    if (!adminEmail) return;

    const itemName = item.item?.name || item.name || "Product Item";
    const claimType = item.claim?.claimType || "Claim";
    const proofUrl = item.claim?.proofUrl || "#";

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #dddddd; border-radius: 8px;">
        <h2 style="color: #c62828; text-align: center;">🚨 New Claim Request Received</h2>
        <p>Hello Admin,</p>
        <p>A customer has filed a dispute/claim for an item in order <strong>#${orderId}</strong>.</p>
        
        <h3 style="color: #333333; border-bottom: 2px solid #c62828; padding-bottom: 5px;">Claim Details</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <tr style="background-color: #f5f5f5;">
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Field</th>
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Information</th>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Item Name:</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${itemName}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Quantity:</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.quantity}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Claim Type:</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #d32f2f; font-weight: bold;">${claimType}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Reason:</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${reason}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Nursery (Vendor) ID:</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.nursery}</td>
          </tr>
        </table>

        ${proofUrl && proofUrl !== "#" ? `
        <div style="margin-top: 20px; text-align: center;">
          <a href="${proofUrl}" target="_blank" style="background-color: #c62828; color: white; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 5px; display: inline-block;">
            View Unboxing Proof File &rarr;
          </a>
        </div>` : ""}
      </div>
    `;

    await sendEmail({
      email: adminEmail,
      subject: `🚨 [Admin Alert] ${claimType} Requested for Order #${orderId}`,
      message: `Admin Alert: Order #${orderId} contains a ${claimType} request for ${itemName}.`,
      html: emailHtml,
      type: "ADMIN_CLAIM_ALERT",
    });
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: ADMIN_CLAIM_ALERT | Error:", error?.message || error);
  }
};

export const sendClaimAlertToNursery = async (
  nurseryId: string,
  orderId: string,
  item: any
): Promise<void> => {
  try {
    const nursery = await User.findById(nurseryId).select("name email").lean();
    if (!nursery || !nursery.email) return;

    const itemName = item.item?.name || item.name || "Product Item";
    const claimType = item.claim?.claimType || "Claim";
    const reason = item.claim?.reason || "No explicit reason specified.";

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #dddddd; border-radius: 8px;">
        <h2 style="color: #e65100; text-align: center;">⚠️ Product Claim Issue - Action Required</h2>
        <p>Hi <strong>${nursery.name}</strong>,</p>
        <p>A customer has raised an issue regarding a product shipped from your inventory for Order <strong>#${orderId}</strong>.</p>
        
        <div style="background-color: #fff3e0; border-left: 5px solid #ffb74d; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0;"><strong>Product:</strong> ${itemName}</p>
          <p style="margin: 0;"><strong>Quantity Impacted:</strong> ${item.quantity}</p>
          <p style="margin: 0;"><strong>Customer Request:</strong> ${claimType}</p>
          <p style="margin: 0;"><strong>Stated Issue:</strong> ${reason}</p>
        </div>

        <p>${BRAND_NAME} Super-Admin team is currently reviewing the unboxing proof data. If approved, you will need to ready a replacement stock or settle a partial vendor reversal balance.</p>
        <p>Please check your <strong>Nursery Claims Dashboard</strong> for more updates.</p>
      </div>
    `;

    await sendEmail({
      email: nursery.email,
      subject: `⚠️ [${BRAND_NAME} Issue] Customer requested ${claimType} for Order #${orderId}`,
      message: `Hi ${nursery.name}, a claim request has been registered for order #${orderId}.`,
      html: emailHtml,
      type: "NURSERY_CLAIM_ALERT",
    });
  } catch (error: any) {
    console.error("[EMAIL ERROR] Type: NURSERY_CLAIM_ALERT | Error:", error?.message || error);
  }
};