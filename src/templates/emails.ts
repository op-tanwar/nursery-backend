import sendEmail from "../utils/sendEmail";
import { getEmailConfig } from "../utils/sendEmail";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const BRAND_NAME = process.env.APP_NAME || "Urban Nursery";
const BRAND_LOGO = `${FRONTEND_URL}/images/logo-new.png`;
const BRAND_COLOR = "#15803d"; // Rich emerald green
const BRAND_ACCENT = "#052e16"; // Deep forest green

// ======================================================================
// 🧱 1. RESPONSIVE BASE EMAIL WRAPPER
// ======================================================================
export interface BaseWrapperProps {
  title: string;
  preheader?: string;
  bodyHtml: string;
  unsubscribeUrl?: string;
  recipientEmail?: string;
}

export const baseEmailWrapper = ({
  title,
  preheader = "Urban Nursery — Fresh plants delivered directly to your doorstep",
  bodyHtml,
  unsubscribeUrl,
  recipientEmail,
}: BaseWrapperProps): string => {
  const currentYear = new Date().getFullYear();
  const config = getEmailConfig();

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${title}</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; padding: 12px !important; }
      .content-cell { padding: 24px 18px !important; }
      .responsive-table th, .responsive-table td { padding: 8px 6px !important; font-size: 13px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 20px 0; background-color: #f1f5f9; color: #1e293b;">
  <!-- Preheader preview text for mail clients -->
  <div style="display: none; font-size: 1px; color: #f1f5f9; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    ${preheader}
  </div>

  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table class="email-container" role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; width: 100%; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #052e16 0%, #15803d 100%); padding: 32px 24px; text-align: center;">
              <a href="${FRONTEND_URL}" target="_blank" style="text-decoration: none; display: inline-block;">
                <span style="color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                  🌿 ${BRAND_NAME}
                </span>
              </a>
              <p style="margin: 8px 0 0 0; color: #bbf7d0; font-size: 13px; font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">
                Certified Plant Marketplace &amp; Green Care
              </p>
            </td>
          </tr>

          <!-- Main Body Content -->
          <tr>
            <td class="content-cell" style="padding: 36px 32px; background-color: #ffffff;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer Information -->
          <tr>
            <td style="background-color: #f8fafc; padding: 28px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; line-height: 1.6;">
              <p style="margin: 0 0 10px 0; font-weight: 600; color: #334155; font-size: 13px;">
                ${BRAND_NAME} • Pure Botanics &amp; Direct Nursery Care
              </p>
              <p style="margin: 0 0 12px 0;">
                Questions or plant emergencies? Reach us at 
                <a href="mailto:${config.fromEmail || config.user || "support@urbannursery.com"}" style="color: #15803d; font-weight: 600; text-decoration: none;">
                  ${config.fromEmail || config.user || "support@urbannursery.com"}
                </a>
              </p>
              <div style="margin: 14px 0;">
                <a href="${FRONTEND_URL}/shop" style="color: #15803d; text-decoration: none; margin: 0 8px; font-weight: 500;">Shop Plants</a> •
                <a href="${FRONTEND_URL}/blogs" style="color: #15803d; text-decoration: none; margin: 0 8px; font-weight: 500;">Plant Guides</a> •
                <a href="${FRONTEND_URL}/contact" style="color: #15803d; text-decoration: none; margin: 0 8px; font-weight: 500;">Contact Us</a>
              </div>
              <p style="margin: 16px 0 4px 0; font-size: 11px; color: #94a3b8;">
                &copy; ${currentYear} ${BRAND_NAME}. All rights reserved. Delivered with care to your green home.
              </p>
              ${
                unsubscribeUrl
                  ? `<p style="margin: 8px 0 0 0; font-size: 11px; color: #94a3b8;">
                      You received this email because you subscribed or registered on our platform. 
                      <a href="${unsubscribeUrl}" style="color: #64748b; text-decoration: underline;">Unsubscribe</a> from this list.
                    </p>`
                  : ""
              }
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
};

// Helper for primary CTA buttons
const ctaButton = (text: string, url: string, color: string = BRAND_COLOR): string => `
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 28px auto; text-align: center;">
    <tr>
      <td align="center" style="border-radius: 10px; background-color: ${color};">
        <a href="${url}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 10px; letter-spacing: 0.2px;">
          ${text} &rarr;
        </a>
      </td>
    </tr>
  </table>
`;

// Helper for info badge cards
const infoBadgeBox = (icon: string, title: string, text: string): string => `
  <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 18px 20px; margin: 22px 0;">
    <div style="font-size: 14px; font-weight: 700; color: #166534; margin-bottom: 6px;">
      ${icon} ${title}
    </div>
    <div style="font-size: 13px; color: #15803d; line-height: 1.5;">
      ${text}
    </div>
  </div>
`;

// ======================================================================
// 🌿 PART 2: PROACTIVE EMAIL TEMPLATES (CUSTOMER)
// ======================================================================

/**
 * 1. Customer: Welcome on Newsletter Subscription
 */
export const getNewsletterWelcomeHtml = (email: string, discountCode: string = "WELCOME10"): string => {
  const unsubscribeUrl = `${FRONTEND_URL}/unsubscribe?email=${encodeURIComponent(email)}`;

  const bodyHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="display: inline-block; background-color: #dcfce7; color: #15803d; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
        🌱 Welcome to the Green Family
      </span>
      <h1 style="color: #0f172a; font-size: 26px; font-weight: 800; margin: 16px 0 8px 0; line-height: 1.2;">
        You're Officially a Plant Parent Insider!
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 auto; max-width: 480px;">
        Thank you for joining the <strong>${BRAND_NAME}</strong> community. Every week, we curate fresh botanic care tips, propagation secrets, and early drops of rare nursery specimens.
      </p>
    </div>

    <!-- Special Promo Code Card -->
    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px dashed #16a34a; border-radius: 14px; padding: 24px; text-align: center; margin: 26px 0;">
      <p style="margin: 0 0 6px 0; font-size: 13px; color: #15803d; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">
        Exclusive Subscriber Gift
      </p>
      <div style="font-size: 28px; font-weight: 900; color: #047857; letter-spacing: 2px; margin: 8px 0;">
        ${discountCode}
      </div>
      <p style="margin: 0; font-size: 13px; color: #334155;">
        Enjoy <strong>10% OFF</strong> your first nursery plant order. Apply at checkout.
      </p>
    </div>

    <div style="margin: 28px 0;">
      <h3 style="color: #0f172a; font-size: 16px; font-weight: 700; margin-bottom: 12px;">
        🌿 What to look forward to:
      </h3>
      <ul style="padding-left: 20px; margin: 0; color: #475569; font-size: 14px; line-height: 1.8;">
        <li><strong>Seasonal Care Calendars:</strong> When to repot, water, and fertilize in your climate.</li>
        <li><strong>Nursery Direct Drops:</strong> First access to exotic Monsteras, Fiddle Leafs, and Air Plants.</li>
        <li><strong>Troubleshooting Hotline:</strong> Plant emergency diagnostics straight from botanists.</li>
      </ul>
    </div>

    ${ctaButton("Explore Plants & Redeem Discount", `${FRONTEND_URL}/shop`)}

    <p style="text-align: center; font-size: 13px; color: #94a3b8; margin-top: 24px;">
      Got a question about indoor greenery? Hit reply to this email anytime.
    </p>
  `;

  return baseEmailWrapper({
    title: `Welcome to ${BRAND_NAME} + Here's 10% Off!`,
    preheader: "Welcome to the Green Club! Enjoy 10% off your first certified nursery plant order.",
    bodyHtml,
    unsubscribeUrl,
    recipientEmail: email,
  });
};

/**
 * 2. Customer: Welcome on Account Registration
 */
export const getAccountWelcomeHtml = (name: string, email: string): string => {
  const bodyHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="color: #0f172a; font-size: 26px; font-weight: 800; margin: 0 0 10px 0;">
        Welcome to ${BRAND_NAME}, ${name}! 🌿
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 auto; max-width: 500px;">
        Your account is verified and ready. You are now part of India's premier verified nursery marketplace, bringing fresh greenery directly from soil to your home.
      </p>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 22px; margin: 24px 0;">
      <h3 style="color: #1e293b; font-size: 15px; font-weight: 700; margin: 0 0 14px 0;">
        What you can do with your account:
      </h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #334155;">🌱 <strong>Direct Local Nursery Access:</strong> Hand-picked, healthy plants guaranteed.</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #334155;">📦 <strong>Live Order Tracking:</strong> Safe potted plant shipping updates at every step.</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #334155;">❤️ <strong>Saved Wishlists:</strong> Keep track of your botanical wishlist and get restock alerts.</td>
        </tr>
      </table>
    </div>

    ${ctaButton("Start Browsing Greenery", `${FRONTEND_URL}/shop`)}
  `;

  return baseEmailWrapper({
    title: `Welcome to ${BRAND_NAME}, ${name}!`,
    preheader: "Your plant shopping account is activated. Explore verified local nurseries.",
    bodyHtml,
    recipientEmail: email,
  });
};

/**
 * 3. Customer: Order Confirmation
 */
export const getOrderConfirmationHtml = (order: any, user: { name: string; email: string }): string => {
  const items = order.orderItems || [];
  const itemsRows = items
    .map((item: any) => {
      const name = item.item?.name || item.name || "Nursery Plant";
      const nurseryName = item.nursery?.businessName || item.nursery?.name || "";
      const qty = item.quantity || 1;
      const price = Number(item.price || item.priceAtPurchase || 0);
      const total = qty * price;
      return `
        <tr>
          <td style="padding: 12px 10px; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #1e293b; font-weight: 500;">
            ${name}
            ${nurseryName ? `<br/><span style="font-size: 11px; color: #15803d; font-weight: 600;">🏡 Fulfilled by: ${nurseryName}</span>` : ""}
          </td>
          <td style="padding: 12px 10px; border-bottom: 1px solid #e2e8f0; text-align: center; font-size: 14px; color: #475569;">
            ${qty}
          </td>
          <td style="padding: 12px 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-size: 14px; color: #475569;">
            ₹${price.toFixed(2)}
          </td>
          <td style="padding: 12px 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-size: 14px; font-weight: 700; color: #15803d;">
            ₹${total.toFixed(2)}
          </td>
        </tr>
      `;
    })
    .join("");

  const shipping = order.shippingInfo || {};
  const isOnline = order.paymentInfo?.id && !order.paymentInfo?.id?.includes("COD");
  const paymentMethodText = isOnline ? "Online Payment (Razorpay)" : (order.paymentInfo?.id || "Prepaid");

  const estDeliveryDate = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const bodyHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="background-color: #dcfce7; color: #15803d; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        ✓ Order Confirmed &amp; Payment Received
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 6px 0;">
        Thank You, ${user.name}!
      </h1>
      <p style="color: #475569; font-size: 14px; margin: 0;">
        Your order <strong>#${order._id}</strong> has been confirmed and our nursery partners are hand-selecting your healthy specimens.
      </p>
    </div>

    <!-- Quick Meta Information Card -->
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 18px; margin: 18px 0; font-size: 13px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 4px 0; color: #64748b;"><strong>Payment Mode:</strong></td>
          <td style="padding: 4px 0; text-align: right; color: #0f172a; font-weight: 600;">${paymentMethodText}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #64748b;"><strong>Estimated Delivery:</strong></td>
          <td style="padding: 4px 0; text-align: right; color: #15803d; font-weight: 700;">${estDeliveryDate}</td>
        </tr>
      </table>
    </div>

    <!-- Items Table -->
    <table class="responsive-table" style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <thead>
        <tr style="background-color: #f8fafc; border-bottom: 2px solid #e2e8f0;">
          <th style="padding: 10px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase;">Item &amp; Nursery</th>
          <th style="padding: 10px; text-align: center; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase;">Qty</th>
          <th style="padding: 10px; text-align: right; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase;">Price</th>
          <th style="padding: 10px; text-align: right; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>

    <!-- Totals Breakdown -->
    <div style="background-color: #f8fafc; border-radius: 12px; padding: 18px; margin: 20px 0;">
      <table style="width: 100%; font-size: 14px; color: #475569; border-collapse: collapse;">
        <tr>
          <td style="padding: 4px 0;">Items Subtotal:</td>
          <td style="padding: 4px 0; text-align: right; font-weight: 600; color: #1e293b;">₹${Number(order.itemsPrice || 0).toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0;">Plant Safe Packaging &amp; Shipping:</td>
          <td style="padding: 4px 0; text-align: right; font-weight: 600; color: #1e293b;">₹${Number(order.shippingPrice || 0).toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0;">Tax (GST):</td>
          <td style="padding: 4px 0; text-align: right; font-weight: 600; color: #1e293b;">₹${Number(order.taxPrice || 0).toFixed(2)}</td>
        </tr>
        <tr style="border-top: 1px solid #cbd5e1;">
          <td style="padding: 10px 0 0 0; font-size: 16px; font-weight: 800; color: #0f172a;">Grand Total:</td>
          <td style="padding: 10px 0 0 0; text-align: right; font-size: 18px; font-weight: 800; color: #15803d;">₹${Number(order.totalPrice || 0).toFixed(2)}</td>
        </tr>
      </table>
    </div>

    <!-- Shipping Address Card -->
    <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 20px 0; font-size: 13px; color: #475569;">
      <h4 style="margin: 0 0 8px 0; font-size: 14px; color: #0f172a; font-weight: 700;">📍 Delivery Destination</h4>
      <p style="margin: 0; line-height: 1.6;">
        <strong>${shipping.name || user.name}</strong><br/>
        ${shipping.address || ""}, ${shipping.city || ""}<br/>
        ${shipping.state || ""}, ${shipping.country || "India"} - ${shipping.pinCode || ""}<br/>
        Phone: ${shipping.phone || "N/A"}
      </p>
    </div>

    ${infoBadgeBox("📦", "Delicate Plant Packaging Guarantee", "All plants are hydrated, root-wrapped, and cushioned with eco-friendly shock-absorbers before leaving the nursery.")}

    ${ctaButton("Track Order Status", `${FRONTEND_URL}/orders/${order._id}`)}
  `;

  return baseEmailWrapper({
    title: `Order Confirmation #${order._id} — ${BRAND_NAME}`,
    preheader: `Thank you for your order #${order._id}. Our nursery specialists are preparing your greenery.`,
    bodyHtml,
    recipientEmail: user.email,
  });
};

/**
 * 4. Customer: Order Status Updates (Dispatched, Shipped, In Transit, Out for Delivery, Delivered, Cancelled)
 */
export const getOrderStatusUpdateHtml = (
  order: any,
  user: { name: string; email: string },
  status: "Dispatched" | "Shipped" | "In Transit" | "Out for Delivery" | "Delivered" | "Cancelled" | string,
  details?: { trackingCourier?: string; trackingId?: string; trackingUrl?: string; reason?: string; refundId?: string; refundAmount?: number }
): string => {
  const statusColors: Record<string, { bg: string; text: string; icon: string }> = {
    Dispatched: { bg: "#e0f2fe", text: "#0284c7", icon: "🚚" },
    Shipped: { bg: "#e0f2fe", text: "#0284c7", icon: "🚚" },
    "In Transit": { bg: "#e0f2fe", text: "#0284c7", icon: "🚚" },
    "Out for Delivery": { bg: "#fef3c7", text: "#d97706", icon: "🛵" },
    Delivered: { bg: "#dcfce7", text: "#15803d", icon: "🎉" },
    Cancelled: { bg: "#fee2e2", text: "#b91c1c", icon: "❌" },
  };

  const currentTheme = statusColors[status] || { bg: "#f1f5f9", text: "#334155", icon: "📦" };

  let statusMessage = "";
  if (status === "Dispatched" || status === "Shipped" || status === "In Transit") {
    statusMessage = `Your plants have left the local nursery and are in transit! ${
      details?.trackingCourier
        ? `Handled by <strong>${details.trackingCourier}</strong> (Tracking ID: <code>${details.trackingId || "In Progress"}</code>).`
        : "Our courier partner is handling your live botanical parcel with care."
    }`;
  } else if (status === "Out for Delivery") {
    statusMessage = "Our delivery executive is on the way with your green parcel today! Please ensure someone is available at your delivery address to receive your plants.";
  } else if (status === "Delivered") {
    statusMessage = "Your plants have arrived safely! Please unbox promptly, inspect the leaves, and provide indirect sunlight with a sip of water.";
  } else if (status === "Cancelled") {
    statusMessage = `Your order #${order._id} has been cancelled. ${details?.reason ? `Reason: ${details.reason}.` : ""} ${
      details?.refundId
        ? `A 100% refund of ₹${Number(details.refundAmount || order.totalPrice || 0).toFixed(2)} has been initiated (Refund ID: <code>${details.refundId}</code>).`
        : "Any prepaid amount is automatically scheduled for reversal to your original payment method."
    }`;
  } else {
    statusMessage = `Your order #${order._id} status has been updated to "${status}".`;
  }

  const hasTracking = Boolean(details?.trackingCourier || details?.trackingId || details?.trackingUrl);

  const bodyHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="display: inline-block; background-color: ${currentTheme.bg}; color: ${currentTheme.text}; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700;">
        ${currentTheme.icon} Status: ${status}
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 16px 0 8px 0;">
        Update on Order #${order._id}
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 auto; max-width: 500px;">
        Hi ${user.name}, ${statusMessage}
      </p>
    </div>

    ${
      hasTracking && (status === "Dispatched" || status === "Shipped" || status === "In Transit")
        ? `
      <div style="background-color: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 18px 20px; margin: 20px 0;">
        <h4 style="margin: 0 0 10px 0; color: #166534; font-size: 14px; font-weight: 700;">🚚 Courier &amp; Tracking Details</h4>
        <p style="margin: 0; font-size: 13px; color: #15803d; line-height: 1.6;">
          <strong>Courier:</strong> ${details?.trackingCourier || "Standard Botanical Logistics"}<br/>
          <strong>Tracking ID:</strong> <code>${details?.trackingId || "Assigned in Transit"}</code>
        </p>
        ${
          details?.trackingUrl
            ? `<div style="margin-top: 12px;"><a href="${details.trackingUrl}" target="_blank" style="display: inline-block; background-color: #15803d; color: #ffffff; padding: 8px 18px; border-radius: 6px; font-size: 13px; text-decoration: none; font-weight: 700;">Track Shipment Live &rarr;</a></div>`
            : ""
        }
      </div>
    `
        : ""
    }

    ${
      status === "Delivered"
        ? `
      <div style="background-color: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 20px; margin: 24px 0;">
        <h4 style="margin: 0 0 10px 0; color: #166534; font-size: 15px; font-weight: 700;">🌱 Unboxing &amp; First 48 Hours Care:</h4>
        <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #15803d; line-height: 1.7;">
          <li>Carefully cut open packaging to avoid snapping young leaves.</li>
          <li>Give soil a gentle finger-check: if completely dry, give 100-200ml room temperature water.</li>
          <li>Place in bright, filtered indirect light (avoid scorching direct sun on day 1).</li>
          <li>Allow plants 7–10 days to acclimate before repotting into a new container.</li>
        </ul>
      </div>
      ${ctaButton("Leave a Plant Review", `${FRONTEND_URL}/orders/${order._id}`)}
    `
        : ctaButton("View Full Order Details", `${FRONTEND_URL}/orders/${order._id}`)
    }
  `;

  return baseEmailWrapper({
    title: `Order #${order._id} is ${status} — ${BRAND_NAME}`,
    preheader: `Update on Order #${order._id}: Status changed to ${status}.`,
    bodyHtml,
    recipientEmail: user.email,
  });
};

/**
 * 5. Customer: Contact Us Inquiry Confirmation
 */
export const getContactConfirmationHtml = (name: string, subject: string, message: string): string => {
  const bodyHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="background-color: #dcfce7; color: #15803d; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        ✓ Message Received
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        We've Got Your Inquiry, ${name}!
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 auto; max-width: 480px;">
        Thank you for reaching out to <strong>${BRAND_NAME}</strong>. Our customer support &amp; botanical consulting team will get back to you within <strong>24 business hours</strong>.
      </p>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 24px 0;">
      <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase;">Subject:</p>
      <p style="margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: #0f172a;">${subject}</p>

      <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase;">Your Message:</p>
      <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; font-size: 13px; color: #334155; line-height: 1.6; font-style: italic;">
        "${message}"
      </div>
    </div>

    ${ctaButton("Browse Frequently Asked Questions", `${FRONTEND_URL}/faq`)}
  `;

  return baseEmailWrapper({
    title: `Inquiry Confirmation: "${subject}" — ${BRAND_NAME}`,
    preheader: "We received your message and our green team is already reviewing it.",
    bodyHtml,
  });
};

/**
 * 6. Customer: Password Reset Request
 */
export const getPasswordResetHtml = (name: string, resetUrl: string, expireMinutes: number = 30): string => {
  const bodyHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 0 0 10px 0;">
        Reset Your Account Password
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 auto; max-width: 480px;">
        Hi ${name}, we received a request to reset your ${BRAND_NAME} password. Click the secure button below to choose a new password.
      </p>
    </div>

    ${ctaButton("Reset Password Now", resetUrl)}

    <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px; margin: 20px 0; font-size: 13px; color: #991b1b; line-height: 1.5;">
      ⚠️ <strong>Security Notice:</strong> This link is valid for <strong>${expireMinutes} minutes</strong> only. If you didn't request a password reset, please ignore this email or contact support immediately.
    </div>

    <p style="font-size: 12px; color: #94a3b8; word-break: break-all; margin-top: 20px;">
      If the button above doesn't work, copy and paste this link into your browser:<br/>
      <a href="${resetUrl}" style="color: #15803d;">${resetUrl}</a>
    </p>
  `;

  return baseEmailWrapper({
    title: `Password Reset Request — ${BRAND_NAME}`,
    preheader: "Reset link for your Urban Nursery plant account.",
    bodyHtml,
  });
};

/**
 * 7. Customer: Payment Failed Notification
 */
export const getPaymentFailedHtml = (customerName: string, orderId: string, retryUrl: string): string => {
  const bodyHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="background-color: #fee2e2; color: #b91c1c; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        ⚠️ Payment Incomplete
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        Payment Failed for Order #${orderId}
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 auto; max-width: 480px;">
        Hi ${customerName}, your transaction could not be processed by your bank or payment provider. Don't worry, your plant items are still temporarily saved in your cart!
      </p>
    </div>

    ${ctaButton("Retry Secure Payment", retryUrl, "#dc2626")}

    <p style="text-align: center; font-size: 13px; color: #64748b;">
      Common reasons include card expiry, insufficient funds, or bank OTP timeout. You can select an alternative payment method (UPI, Netbanking, Cards) at checkout.
    </p>
  `;

  return baseEmailWrapper({
    title: `Payment Issue for Order #${orderId} — ${BRAND_NAME}`,
    preheader: "Action required: Complete payment to lock in your nursery plant order.",
    bodyHtml,
  });
};

/**
 * 8. Customer: Refund Initiated
 */
export const getRefundInitiatedHtml = (customerName: string, orderId: string, amount: number, refundId?: string): string => {
  const bodyHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="background-color: #dcfce7; color: #15803d; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        ✓ Refund Processed
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        Refund of ₹${amount.toFixed(2)} Initiated
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 auto; max-width: 480px;">
        Hi ${customerName}, we have successfully initiated a refund for Order <strong>#${orderId}</strong>.
      </p>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; font-size: 14px; color: #334155;">
      <p style="margin: 0 0 6px 0;"><strong>Refund Amount:</strong> ₹${amount.toFixed(2)}</p>
      ${refundId ? `<p style="margin: 0 0 6px 0;"><strong>Refund Reference ID:</strong> <code>${refundId}</code></p>` : ""}
      <p style="margin: 0;"><strong>Estimated Arrival:</strong> 5 to 7 business days into your original payment source.</p>
    </div>

    ${ctaButton("Back to Nursery Catalog", `${FRONTEND_URL}/shop`)}
  `;

  return baseEmailWrapper({
    title: `Refund Initiated for Order #${orderId} — ${BRAND_NAME}`,
    preheader: `Refund of ₹${amount.toFixed(2)} has been initiated for your order.`,
    bodyHtml,
  });
};

/**
 * 8B. Customer: Return or Replacement Request Notification & Status Progression
 */
export const getReturnRequestCustomerHtml = (
  customerName: string,
  orderId: string,
  requestType: "Return" | "Replacement" | string,
  productName: string,
  reason: string,
  status: "Pending" | "Approved" | "Rejected" | "Completed" | string,
  adminComments?: string
): string => {
  const isInitial = status === "Pending";
  const isApproved = status === "Approved" || status === "Completed";
  const isRejected = status === "Rejected";

  const badgeBg = isInitial ? "#e0f2fe" : isApproved ? "#dcfce7" : "#fee2e2";
  const badgeColor = isInitial ? "#0284c7" : isApproved ? "#15803d" : "#b91c1c";
  const badgeText = isInitial ? "⏳ Request Received" : isApproved ? "✅ Request Approved" : "❌ Request Declined";

  const bodyHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="display: inline-block; background-color: ${badgeBg}; color: ${badgeColor}; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        ${badgeText}
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        ${requestType} Request: Order #${orderId}
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 auto; max-width: 500px;">
        Hi ${customerName}, ${
          isInitial
            ? `we have received your ${requestType.toLowerCase()} request for <strong>${productName}</strong>. Our botanists and the fulfilling nursery will review your unboxing details within 24–48 business hours.`
            : isApproved
            ? `your ${requestType.toLowerCase()} request for <strong>${productName}</strong> has been <strong>approved</strong>. We are coordinating the resolution immediately.`
            : `an update regarding your ${requestType.toLowerCase()} request for <strong>${productName}</strong>.`
        }
      </p>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; font-size: 14px; color: #334155;">
      <p style="margin: 0 0 8px 0;"><strong>Product:</strong> ${productName}</p>
      <p style="margin: 0 0 8px 0;"><strong>Request Type:</strong> ${requestType}</p>
      <p style="margin: 0 0 8px 0;"><strong>Reason:</strong> ${reason}</p>
      <p style="margin: 0 0 8px 0;"><strong>Current Status:</strong> <span style="font-weight: 700; color: ${badgeColor};">${status}</span></p>
      ${
        adminComments
          ? `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e2e8f0;"><strong>Resolution Details:</strong><br/><span style="color: #475569;">${adminComments}</span></div>`
          : ""
      }
    </div>

    ${infoBadgeBox("🌿", "Urban Nursery Plant Health Guarantee", "Every plant should arrive vibrant and thriving. If shock or damage occurred during transit, our team resolves it swiftly.")}

    ${ctaButton("View Order & Claims", `${FRONTEND_URL}/orders/${orderId}`)}
  `;

  return baseEmailWrapper({
    title: `${requestType} Request ${status} — Order #${orderId}`,
    preheader: `${requestType} request for ${productName} (Order #${orderId}) status: ${status}.`,
    bodyHtml,
  });
};

// ======================================================================
// 🏡 PART 3: PROACTIVE EMAIL TEMPLATES (NURSERY / VENDOR ADMIN)
// ======================================================================

/**
 * 9. Vendor: New Order Received Alert
 */
export const getNurseryNewOrderAlertHtml = (
  nurseryName: string,
  orderId: string,
  items: any[],
  shippingCity: string,
  shippingPinCode?: string
): string => {
  const itemsList = items
    .map(
      (item) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 14px; font-weight: 600;">${item.item?.name || item.name || "Plant"}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: center; font-size: 14px;">${item.quantity || 1}</td>
      </tr>`
    )
    .join("");

  const destinationDisplay = `${shippingCity}${shippingPinCode ? ` (Pincode: ${shippingPinCode})` : ""}`;

  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #dbeafe; color: #1d4ed8; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        🔔 Action Required
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        New Order Alert for ${nurseryName}!
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        You have received a new customer order <strong>#${orderId}</strong> for delivery to <strong>${destinationDisplay}</strong>.
      </p>
    </div>

    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background-color: #f8fafc; border-radius: 8px;">
      <thead>
        <tr style="border-bottom: 1px solid #cbd5e1;">
          <th style="padding: 10px; text-align: left; font-size: 12px; text-transform: uppercase;">Plant / Product</th>
          <th style="padding: 10px; text-align: center; font-size: 12px; text-transform: uppercase;">Quantity</th>
        </tr>
      </thead>
      <tbody>
        ${itemsList}
      </tbody>
    </table>

    ${infoBadgeBox("⏰", "Packaging SLA: 24 Hours", "Please inspect root hydration, pack with protective aeration sleeves, and hand over to our courier partner within 24 hours.")}

    ${ctaButton("Open Nursery Dashboard & Pack", `${FRONTEND_URL}/vendor/dashboard`)}
  `;

  return baseEmailWrapper({
    title: `[NEW ORDER] Order #${orderId} — Prepare for Dispatch`,
    preheader: `New order #${orderId} received. Destination: ${destinationDisplay}. Prepare plants for dispatch.`,
    bodyHtml,
  });
};

/**
 * 9B. Vendor: Order Cancelled Alert (Halt Dispatch)
 */
export const getNurseryOrderCancelledAlertHtml = (
  nurseryName: string,
  orderId: string,
  items: any[],
  reason?: string
): string => {
  const itemsList = items
    .map(
      (item) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 14px; font-weight: 600;">${item.item?.name || item.name || "Plant"}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: center; font-size: 14px;">${item.quantity || 1}</td>
      </tr>`
    )
    .join("");

  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #fee2e2; color: #b91c1c; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        🛑 HALT DISPATCH
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        Order #${orderId} Has Been Cancelled
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        Attention <strong>${nurseryName}</strong>, order <strong>#${orderId}</strong> containing items from your nursery was cancelled ${reason ? `(Reason: ${reason})` : ""}.
      </p>
    </div>

    <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 18px; margin: 20px 0; font-size: 14px; color: #991b1b;">
      ⚠️ <strong>Action Required:</strong> Please halt packaging immediately. Do NOT hand over this parcel to the courier partner. Your inventory has been automatically restored in the catalog.
    </div>

    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background-color: #f8fafc; border-radius: 8px;">
      <thead>
        <tr style="border-bottom: 1px solid #cbd5e1;">
          <th style="padding: 10px; text-align: left; font-size: 12px; text-transform: uppercase;">Cancelled Product</th>
          <th style="padding: 10px; text-align: center; font-size: 12px; text-transform: uppercase;">Quantity Restored</th>
        </tr>
      </thead>
      <tbody>
        ${itemsList}
      </tbody>
    </table>

    ${ctaButton("Go to Nursery Dashboard", `${FRONTEND_URL}/vendor/dashboard`)}
  `;

  return baseEmailWrapper({
    title: `[HALT DISPATCH] Order #${orderId} Cancelled — ${BRAND_NAME}`,
    preheader: `Order #${orderId} was cancelled. Halt packaging and dispatch immediately.`,
    bodyHtml,
  });
};

/**
 * 9C. Vendor: Return / Replacement Request Alert
 */
export const getNurseryReturnAlertHtml = (
  nurseryName: string,
  orderId: string,
  productName: string,
  requestType: string,
  reason: string,
  proofUrl?: string
): string => {
  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #fef3c7; color: #b45309; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        ⚠️ Customer Claim
      </span>
      <h1 style="color: #0f172a; font-size: 22px; font-weight: 800; margin: 14px 0 8px 0;">
        ${requestType} Requested for Order #${orderId}
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        Hi <strong>${nurseryName}</strong>, a customer has reported an issue with <strong>${productName}</strong> from Order <strong>#${orderId}</strong>.
      </p>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 20px 0; font-size: 14px; color: #334155;">
      <p style="margin: 0 0 6px 0;"><strong>Product:</strong> ${productName}</p>
      <p style="margin: 0 0 6px 0;"><strong>Claim Type:</strong> ${requestType}</p>
      <p style="margin: 0 0 6px 0;"><strong>Stated Issue:</strong> ${reason}</p>
      ${proofUrl && proofUrl !== "#" ? `<p style="margin: 8px 0 0 0;"><a href="${proofUrl}" target="_blank" style="color: #15803d; font-weight: 600;">View Customer Unboxing Photo &rarr;</a></p>` : ""}
    </div>

    <p style="font-size: 13px; color: #64748b;">
      The central botanical support team is reviewing the claim. Check your vendor claims dashboard for details.
    </p>

    ${ctaButton("Open Nursery Dashboard", `${FRONTEND_URL}/vendor/dashboard`)}
  `;

  return baseEmailWrapper({
    title: `[CLAIM ALERT] ${requestType} for Order #${orderId} — ${productName}`,
    preheader: `A customer has requested ${requestType} for ${productName} (Order #${orderId}).`,
    bodyHtml,
  });
};

/**
 * 10. Vendor: Low Stock Warning Alert
 */
export const getLowStockAlertHtml = (
  nurseryName: string,
  productName: string,
  currentStock: number,
  threshold: number = 5
): string => {
  const isOutOfStock = currentStock <= 0;

  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: ${isOutOfStock ? "#fee2e2" : "#fef3c7"}; color: ${isOutOfStock ? "#b91c1c" : "#b45309"}; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        ${isOutOfStock ? "🚨 OUT OF STOCK" : "⚠️ LOW STOCK ALERT"}
      </span>
      <h1 style="color: #0f172a; font-size: 22px; font-weight: 800; margin: 14px 0 8px 0;">
        ${productName} Inventory Alert
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        Attention <strong>${nurseryName}</strong>, your stock for <strong>${productName}</strong> is ${
    isOutOfStock ? "completely exhausted" : `running low at only <strong>${currentStock} unit(s) remaining</strong> (Threshold: ${threshold})`
  }.
      </p>
    </div>

    ${ctaButton("Update Nursery Stock Now", `${FRONTEND_URL}/vendor/dashboard`)}
  `;

  return baseEmailWrapper({
    title: `[INVENTORY ALERT] ${productName} Stock is ${isOutOfStock ? "0" : "Low"}`,
    preheader: `Stock update needed for ${productName} in your nursery portal.`,
    bodyHtml,
  });
};

/**
 * 11. Vendor: Payout Update Alert
 */
export const getVendorPayoutUpdateHtml = (
  nurseryName: string,
  amount: number,
  status: "Requested" | "Approved" | "Completed" | "Rejected",
  payoutId?: string,
  note?: string
): string => {
  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #dcfce7; color: #15803d; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        💰 Payout Status: ${status}
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        Vendor Payout of ₹${amount.toFixed(2)}
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        Hi ${nurseryName}, your settlement payout of <strong>₹${amount.toFixed(2)}</strong> has been updated to <strong>${status}</strong>.
      </p>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 20px 0; font-size: 14px; color: #334155;">
      ${payoutId ? `<p style="margin: 0 0 6px 0;"><strong>Payout ID:</strong> <code>${payoutId}</code></p>` : ""}
      <p style="margin: 0 0 6px 0;"><strong>Status:</strong> ${status}</p>
      ${note ? `<p style="margin: 0;"><strong>Notes:</strong> ${note}</p>` : ""}
    </div>

    ${ctaButton("View Nursery Financial Ledger", `${FRONTEND_URL}/vendor/dashboard`)}
  `;

  return baseEmailWrapper({
    title: `Payout #${payoutId || ""} ${status} — ₹${amount.toFixed(2)}`,
    preheader: `Your nursery payout of ₹${amount.toFixed(2)} status is ${status}.`,
    bodyHtml,
  });
};

// ======================================================================
// 🛡️ PART 4: PROACTIVE EMAIL TEMPLATES (SUPER ADMIN)
// ======================================================================

/**
 * 12. Super Admin: New Newsletter Subscriber Alert
 */
export const getAdminNewSubscriberAlertHtml = (
  subscriberEmail: string,
  totalSubscribers: number = 0
): string => {
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #dcfce7; color: #15803d; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        🌱 Growth Alert
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        New Newsletter Subscriber!
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        A new user just subscribed to the <strong>${BRAND_NAME}</strong> green mailing list.
      </p>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 22px; margin: 20px 0;">
      <table style="width: 100%; font-size: 14px; color: #334155; border-collapse: collapse;">
        <tr>
          <td style="padding: 6px 0; font-weight: 600;">Subscriber Email:</td>
          <td style="padding: 6px 0; text-align: right; color: #15803d; font-weight: 700;">${subscriberEmail}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-weight: 600;">Subscribed At:</td>
          <td style="padding: 6px 0; text-align: right; color: #64748b;">${timestamp} IST</td>
        </tr>
        ${
          totalSubscribers > 0
            ? `<tr>
                <td style="padding: 6px 0; font-weight: 600;">Total Active Audience:</td>
                <td style="padding: 6px 0; text-align: right; font-weight: 800; color: #0f172a;">${totalSubscribers} subscribers</td>
              </tr>`
            : ""
        }
      </table>
    </div>

    ${ctaButton("View All Subscribers in Admin", `${FRONTEND_URL}/admin/newsletter-subscribers`)}
  `;

  return baseEmailWrapper({
    title: `[SUBSCRIBER] New subscriber: ${subscriberEmail}`,
    preheader: `New subscriber alert: ${subscriberEmail} joined your green mailing list.`,
    bodyHtml,
  });
};

/**
 * 13. Super Admin: New Order Summary Alert
 */
export const getAdminNewOrderAlertHtml = (
  orderId: string,
  totalAmount: number,
  customerName: string,
  itemsCount: number
): string => {
  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #dbeafe; color: #1d4ed8; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        🛒 New Order Received
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        Order #${orderId} Placed (₹${totalAmount.toFixed(2)})
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        Customer <strong>${customerName}</strong> has placed an order containing <strong>${itemsCount} item(s)</strong>.
      </p>
    </div>

    ${ctaButton("Review Order in Admin Panel", `${FRONTEND_URL}/admin/orders/${orderId}`)}
  `;

  return baseEmailWrapper({
    title: `[NEW SALE] Order #${orderId} — ₹${totalAmount.toFixed(2)}`,
    preheader: `New order #${orderId} by ${customerName} for ₹${totalAmount.toFixed(2)}.`,
    bodyHtml,
  });
};

/**
 * 13B. Super Admin: Inventory Collision & Fallback Auto-Refund Anomaly Alert
 */
export const getAdminStockCollisionAlertHtml = (details: {
  orderId: string;
  paymentId: string;
  amount: number;
  customerName: string;
  customerEmail: string;
  refundId?: string;
  reason: string;
  items?: any[];
}): string => {
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const itemsText = details.items?.map((i: any) => `${i.name || i.item?.name || "Item"} x${i.quantity || 1}`).join(", ") || "N/A";

  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #fee2e2; color: #b91c1c; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        🚨 SYSTEM ANOMALY: AUTO-REFUND TRIGGERED
      </span>
      <h1 style="color: #0f172a; font-size: 22px; font-weight: 800; margin: 14px 0 8px 0;">
        Stock Collision Post-TTL / Auto-Refund Executed
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        A customer paid at the Razorpay gateway, but the 15-minute checkout reservation expired and inventory was claimed by another customer. The fallback refund engine executed a 100% automated refund.
      </p>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; font-size: 14px; color: #334155;">
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 6px 0; font-weight: 600; width: 40%;">Order Reference:</td><td style="padding: 6px 0;"><code>#${details.orderId}</code></td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 6px 0; font-weight: 600;">Razorpay Payment ID:</td><td style="padding: 6px 0;"><code>${details.paymentId}</code></td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 6px 0; font-weight: 600;">Razorpay Refund ID:</td><td style="padding: 6px 0; color: #15803d; font-weight: 700;"><code>${details.refundId || "Initiated"}</code></td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 6px 0; font-weight: 600;">Refunded Amount:</td><td style="padding: 6px 0; font-weight: 800; color: #0f172a;">₹${details.amount.toFixed(2)}</td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 6px 0; font-weight: 600;">Customer:</td><td style="padding: 6px 0;">${details.customerName} (${details.customerEmail})</td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 6px 0; font-weight: 600;">Affected Item(s):</td><td style="padding: 6px 0;">${itemsText}</td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 6px 0; font-weight: 600;">Reason Code:</td><td style="padding: 6px 0; color: #b91c1c; font-weight: 600;">${details.reason}</td></tr>
        <tr><td style="padding: 6px 0; font-weight: 600;">Timestamp:</td><td style="padding: 6px 0;">${timestamp} IST</td></tr>
      </table>
    </div>

    ${ctaButton("Review Transaction Ledger in Admin", `${FRONTEND_URL}/admin/orders`)}
  `;

  return baseEmailWrapper({
    title: `[ANOMALY] Fallback Refund ₹${details.amount.toFixed(2)} for Order #${details.orderId}`,
    preheader: `Automatic fallback refund of ₹${details.amount.toFixed(2)} triggered for ${details.customerName} due to inventory exhaustion.`,
    bodyHtml,
  });
};

/**
 * 13C. Super Admin: Return / Replacement Dispute Raised Alert
 */
export const getAdminReturnDisputeAlertHtml = (details: {
  returnId: string;
  orderId: string;
  customerName: string;
  customerEmail: string;
  nurseryName: string;
  productName: string;
  requestType: string;
  reason: string;
  description: string;
  proofUrl?: string;
}): string => {
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #fee2e2; color: #b91c1c; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        ⚖️ DISPUTE / CLAIM RAISED
      </span>
      <h1 style="color: #0f172a; font-size: 22px; font-weight: 800; margin: 14px 0 8px 0;">
        New ${details.requestType} Request: Order #${details.orderId}
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        Customer <strong>${details.customerName}</strong> filed a ${details.requestType.toLowerCase()} claim for item supplied by <strong>${details.nurseryName}</strong>.
      </p>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; font-size: 14px; color: #334155;">
      <p style="margin: 0 0 6px 0;"><strong>Claim ID:</strong> <code>#${details.returnId}</code></p>
      <p style="margin: 0 0 6px 0;"><strong>Order ID:</strong> <code>#${details.orderId}</code></p>
      <p style="margin: 0 0 6px 0;"><strong>Customer:</strong> ${details.customerName} (<a href="mailto:${details.customerEmail}" style="color: #15803d;">${details.customerEmail}</a>)</p>
      <p style="margin: 0 0 6px 0;"><strong>Fulfilling Nursery:</strong> ${details.nurseryName}</p>
      <p style="margin: 0 0 6px 0;"><strong>Product:</strong> ${details.productName}</p>
      <p style="margin: 0 0 6px 0;"><strong>Reason:</strong> ${details.reason}</p>
      <p style="margin: 0 0 10px 0;"><strong>Description:</strong> <em>"${details.description}"</em></p>
      <p style="margin: 0;"><strong>Submitted At:</strong> ${timestamp} IST</p>
      ${details.proofUrl && details.proofUrl !== "#" ? `<div style="margin-top: 14px;"><a href="${details.proofUrl}" target="_blank" style="color: #15803d; font-weight: 700;">View Uploaded Proof Photo &rarr;</a></div>` : ""}
    </div>

    ${ctaButton("Review & Resolve Claim in Admin", `${FRONTEND_URL}/admin/returns`)}
  `;

  return baseEmailWrapper({
    title: `[DISPUTE] ${details.requestType} filed for Order #${details.orderId} (${details.nurseryName})`,
    preheader: `New ${details.requestType} claim for ${details.productName} by ${details.customerName}.`,
    bodyHtml,
  });
};

/**
 * 13D. Super Admin: High-Value Order Alert
 */
export const getAdminHighValueOrderAlertHtml = (
  orderId: string,
  totalAmount: number,
  customerName: string,
  customerEmail: string,
  itemsCount: number
): string => {
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #dbeafe; color: #1e40af; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        💎 HIGH-VALUE ORDER
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        Major Sale Alert: ₹${totalAmount.toFixed(2)}
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        Order <strong>#${orderId}</strong> exceeds the ₹10,000 threshold and has been placed successfully.
      </p>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; font-size: 14px; color: #334155;">
      <p style="margin: 0 0 6px 0;"><strong>Order ID:</strong> #${orderId}</p>
      <p style="margin: 0 0 6px 0;"><strong>Total Value:</strong> <span style="font-size: 18px; font-weight: 800; color: #15803d;">₹${totalAmount.toFixed(2)}</span></p>
      <p style="margin: 0 0 6px 0;"><strong>Customer:</strong> ${customerName} (${customerEmail})</p>
      <p style="margin: 0 0 6px 0;"><strong>Items Count:</strong> ${itemsCount}</p>
      <p style="margin: 0;"><strong>Placed At:</strong> ${timestamp} IST</p>
    </div>

    ${ctaButton("Open Order in Admin", `${FRONTEND_URL}/admin/orders/${orderId}`)}
  `;

  return baseEmailWrapper({
    title: `💎 [HIGH-VALUE SALE] Order #${orderId} — ₹${totalAmount.toFixed(2)}`,
    preheader: `High-value order #${orderId} placed by ${customerName} for ₹${totalAmount.toFixed(2)}.`,
    bodyHtml,
  });
};

/**
 * 14. Super Admin: Contact Form Submission Alert
 */
export const getAdminContactInquiryAlertHtml = (
  name: string,
  email: string,
  subject: string,
  message: string
): string => {
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #fef3c7; color: #b45309; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        💬 Contact Form Inquiry
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        New Inquiry: "${subject}"
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        A user has submitted the contact form on your storefront.
      </p>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; font-size: 14px; color: #334155;">
      <p style="margin: 0 0 6px 0;"><strong>Sender Name:</strong> ${name}</p>
      <p style="margin: 0 0 6px 0;"><strong>Sender Email:</strong> <a href="mailto:${email}" style="color: #15803d;">${email}</a></p>
      <p style="margin: 0 0 12px 0;"><strong>Received At:</strong> ${timestamp} IST</p>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 12px 0;"/>
      <p style="margin: 0 0 6px 0; font-weight: 700;">Message Content:</p>
      <div style="background-color: #ffffff; padding: 14px; border-radius: 8px; border: 1px solid #e2e8f0; line-height: 1.6; white-space: pre-wrap;">
${message}
      </div>
    </div>

    ${ctaButton("Reply Directly to Customer", `mailto:${email}?subject=Re: ${encodeURIComponent(subject)}`)}
  `;

  return baseEmailWrapper({
    title: `[INQUIRY] ${name} — "${subject}"`,
    preheader: `New customer inquiry from ${name}: "${message.slice(0, 80)}..."`,
    bodyHtml,
  });
};

/**
 * 15. Super Admin: New User / Vendor Registration Alert
 */
export const getAdminNewUserAlertHtml = (
  userType: "Customer" | "Vendor",
  name: string,
  email: string
): string => {
  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #dcfce7; color: #15803d; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        👤 New Registration
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        New ${userType} Signed Up
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        A new ${userType.toLowerCase()} profile has registered on the platform.
      </p>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; font-size: 14px; color: #334155;">
      <p style="margin: 0 0 6px 0;"><strong>Name:</strong> ${name}</p>
      <p style="margin: 0 0 6px 0;"><strong>Email:</strong> ${email}</p>
      <p style="margin: 0;"><strong>Role:</strong> ${userType}</p>
    </div>

    ${ctaButton("View Users in Admin Panel", `${FRONTEND_URL}/admin/users`)}
  `;

  return baseEmailWrapper({
    title: `[NEW ${userType.toUpperCase()}] ${name} registered`,
    preheader: `New ${userType.toLowerCase()} signed up: ${name} (${email}).`,
    bodyHtml,
  });
};

// ======================================================================
// 🏡 PART 4B: NURSERY ONBOARDING & PAYOUT TEMPLATES
// ======================================================================

/**
 * 16. Nursery: Application Received Acknowledgement
 */
export const getNurseryApplicationReceivedHtml = (
  nurseryName: string,
  businessName: string,
  applicationId: string
): string => {
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #dbeafe; color: #1d4ed8; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        📋 Application Submitted
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        We've Received Your Nursery Application!
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        Hi <strong>${nurseryName}</strong>, thank you for applying to become a vendor on <strong>${BRAND_NAME}</strong>. Our team will review your application and documents within <strong>2–3 business days</strong>.
      </p>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; font-size: 14px; color: #334155;">
      <p style="margin: 0 0 6px 0;"><strong>Business Name:</strong> ${businessName}</p>
      <p style="margin: 0 0 6px 0;"><strong>Application Reference:</strong> <code>${applicationId}</code></p>
      <p style="margin: 0;"><strong>Submitted At:</strong> ${timestamp} IST</p>
    </div>

    ${infoBadgeBox("📄", "Next Steps", "Upload your business documents (GST, PAN, Nursery License) from your vendor dashboard to speed up verification.")}

    ${ctaButton("Upload Documents in Dashboard", `${FRONTEND_URL}/vendor/dashboard`)}
  `;

  return baseEmailWrapper({
    title: `Application Received — ${BRAND_NAME}`,
    preheader: `Your nursery vendor application for ${businessName} has been received and is under review.`,
    bodyHtml,
  });
};

/**
 * 17. Nursery: Application Approved
 */
export const getNurseryApprovalHtml = (
  nurseryName: string,
  businessName: string
): string => {
  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #dcfce7; color: #15803d; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        ✅ Application Approved
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        Congratulations! Your Nursery is Live 🌿
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        Hi <strong>${nurseryName}</strong>, your nursery <strong>${businessName}</strong> has been <strong style="color: #15803d;">approved</strong> and is now live on <strong>${BRAND_NAME}</strong>. You can start listing plants and products immediately!
      </p>
    </div>

    ${infoBadgeBox("🚀", "Get Started", "Head to your vendor dashboard to list your first products, set up your bank details for payouts, and configure your delivery coverage.")}

    ${ctaButton("Open Vendor Dashboard", `${FRONTEND_URL}/vendor/dashboard`)}
  `;

  return baseEmailWrapper({
    title: `🎉 Your Nursery is Approved — ${BRAND_NAME}`,
    preheader: `Great news! ${businessName} is now an approved vendor on ${BRAND_NAME}.`,
    bodyHtml,
  });
};

/**
 * 18. Nursery: Application Rejected
 */
export const getNurseryRejectionHtml = (
  nurseryName: string,
  businessName: string,
  rejectionReason: string
): string => {
  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #fee2e2; color: #b91c1c; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        ❌ Application Not Approved
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        Update on Your Nursery Application
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        Hi <strong>${nurseryName}</strong>, unfortunately your nursery application for <strong>${businessName}</strong> could not be approved at this time.
      </p>
    </div>

    <div style="background-color: #fff7f7; border: 1px solid #fecaca; border-radius: 12px; padding: 20px; margin: 20px 0; font-size: 14px; color: #7f1d1d;">
      <p style="margin: 0 0 8px 0; font-weight: 700; font-size: 15px;">Reason:</p>
      <p style="margin: 0; line-height: 1.6;">${rejectionReason}</p>
    </div>

    ${infoBadgeBox("📧", "Need Help?", `If you believe this is an error or have additional documents to provide, please contact our support team at ${FRONTEND_URL}/contact and we'll be happy to assist.`)}

    ${ctaButton("Contact Support", `${FRONTEND_URL}/contact`)}
  `;

  return baseEmailWrapper({
    title: `Application Update — ${BRAND_NAME}`,
    preheader: `An update on your nursery vendor application for ${businessName}.`,
    bodyHtml,
  });
};

/**
 * 19. Customer/Vendor: Password Changed Security Alert
 */
export const getPasswordChangedAlertHtml = (
  name: string,
  email: string
): string => {
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #fef3c7; color: #b45309; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        🔒 Security Alert
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        Your Password Was Changed
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        Hi <strong>${name}</strong>, the password for your account <strong>${email}</strong> was successfully changed.
      </p>
    </div>

    <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 20px; margin: 20px 0; font-size: 14px; color: #78350f;">
      <p style="margin: 0 0 6px 0;"><strong>Account:</strong> ${email}</p>
      <p style="margin: 0;"><strong>Changed At:</strong> ${timestamp} IST</p>
    </div>

    ${infoBadgeBox("⚠️", "Wasn't you?", "If you did not change your password, please contact our support team immediately and reset your password.")}

    ${ctaButton("Contact Support Immediately", `${FRONTEND_URL}/contact`)}
  `;

  return baseEmailWrapper({
    title: `🔒 Password Changed — ${BRAND_NAME}`,
    preheader: `Security notice: The password for your ${BRAND_NAME} account was changed.`,
    bodyHtml,
  });
};

// ======================================================================
// 🚀 PART 5: HIGH-LEVEL EMAIL DISPATCHERS (NON-BLOCKING SAFE WRAPPERS)
// ======================================================================

/**
 * Dispatch Welcome Email to new newsletter subscriber
 */
export const sendNewsletterWelcomeEmail = async (toEmail: string, discountCode: string = "WELCOME10") => {
  const html = getNewsletterWelcomeHtml(toEmail, discountCode);
  return sendEmail({
    email: toEmail,
    subject: `🌱 Welcome to ${BRAND_NAME}! Here's 10% Off Your First Plant Order`,
    message: `Welcome to ${BRAND_NAME}! Use code ${discountCode} for 10% off your first order.`,
    html,
  }).catch((err) => {
    console.error("Non-fatal: Failed to send newsletter welcome email:", err);
  });
};

/**
 * Dispatch notification to Super Admin about new newsletter subscriber
 */
export const sendAdminNewSubscriberAlert = async (subscriberEmail: string, totalCount: number = 0) => {
  const config = getEmailConfig();
  if (!config.adminEmail) return;

  const html = getAdminNewSubscriberAlertHtml(subscriberEmail, totalCount);
  return sendEmail({
    email: config.adminEmail,
    subject: `🌱 [Urban Nursery Alert] New Newsletter Subscriber: ${subscriberEmail}`,
    message: `A new user has subscribed to the newsletter: ${subscriberEmail}`,
    html,
  }).catch((err) => {
    console.error("Non-fatal: Failed to send admin subscriber alert:", err);
  });
};

/**
 * Dispatch Contact Inquiry confirmation to customer + alert to admin
 */
export const sendContactInquiryEmails = async (
  name: string,
  email: string,
  subject: string,
  message: string
) => {
  const config = getEmailConfig();

  // 1. Customer confirmation
  sendEmail({
    email,
    subject: `Inquiry Received: ${subject} — ${BRAND_NAME}`,
    message: `Hi ${name}, thank you for contacting us. We'll reply within 24 hours.`,
    html: getContactConfirmationHtml(name, subject, message),
  }).catch((err) => console.error("Non-fatal: Customer contact email failed:", err));

  // 2. Admin alert
  if (config.adminEmail) {
    sendEmail({
      email: config.adminEmail,
      subject: `💬 [New Inquiry] "${subject}" from ${name}`,
      message: `New message from ${name} (${email}): ${message}`,
      html: getAdminContactInquiryAlertHtml(name, email, subject, message),
      replyTo: email,
    }).catch((err) => console.error("Non-fatal: Admin contact alert failed:", err));
  }
};

/**
 * Dispatch Payout Status Email to Vendor Nursery
 */
export const sendPayoutStatusEmail = async (
  nurseryEmail: string,
  nurseryName: string,
  amount: number,
  status: "Requested" | "Approved" | "Completed" | "Rejected",
  payoutId?: string,
  note?: string
) => {
  const subjectMap: Record<string, string> = {
    Requested: `💰 Payout Request Received — ₹${amount.toFixed(2)}`,
    Approved:  `✅ Payout Approved — ₹${amount.toFixed(2)}`,
    Completed: `🎉 Payout Completed — ₹${amount.toFixed(2)} Transferred`,
    Rejected:  `❌ Payout Request Rejected — ₹${amount.toFixed(2)}`,
  };

  return sendEmail({
    email: nurseryEmail,
    subject: subjectMap[status] || `Payout Update — ₹${amount.toFixed(2)}`,
    message: `Hi ${nurseryName}, your payout of ₹${amount.toFixed(2)} status is now: ${status}.`,
    html: getVendorPayoutUpdateHtml(nurseryName, amount, status, payoutId, note),
  }).catch((err) => {
    console.error(`❌ [Email Trigger Failed] Event: PayoutStatus-${status}, Error: ${err.message}`);
  });
};

/**
 * Dispatch Nursery Application Received email to the applying vendor
 */
export const sendNurseryApplicationReceivedEmail = async (
  nurseryEmail: string,
  nurseryName: string,
  businessName: string,
  applicationId: string
) => {
  return sendEmail({
    email: nurseryEmail,
    subject: `📋 Application Received — ${BRAND_NAME} Vendor Program`,
    message: `Hi ${nurseryName}, your nursery vendor application for ${businessName} has been received and is under review.`,
    html: getNurseryApplicationReceivedHtml(nurseryName, businessName, applicationId),
  }).catch((err) => {
    console.error(`❌ [Email Trigger Failed] Event: NurseryApplicationReceived, Error: ${err.message}`);
  });
};

/**
 * Dispatch Nursery Approval or Rejection email
 */
export const sendNurseryStatusEmail = async (
  nurseryEmail: string,
  nurseryName: string,
  businessName: string,
  status: "Approved" | "Rejected",
  rejectionReason?: string
) => {
  const html =
    status === "Approved"
      ? getNurseryApprovalHtml(nurseryName, businessName)
      : getNurseryRejectionHtml(nurseryName, businessName, rejectionReason || "Document verification failed.");

  const subject =
    status === "Approved"
      ? `🎉 Congratulations! ${businessName} is now Approved on ${BRAND_NAME}`
      : `Update on Your Nursery Application — ${businessName}`;

  return sendEmail({
    email: nurseryEmail,
    subject,
    message:
      status === "Approved"
        ? `Your nursery ${businessName} has been approved! You can now start listing products.`
        : `Your nursery application for ${businessName} was not approved. Reason: ${rejectionReason}`,
    html,
  }).catch((err) => {
    console.error(`❌ [Email Trigger Failed] Event: NurseryStatus-${status}, Error: ${err.message}`);
  });
};

/**
 * Dispatch Password Changed Security Alert email
 */
export const sendPasswordChangedAlert = async (
  userEmail: string,
  userName: string
) => {
  return sendEmail({
    email: userEmail,
    subject: `🔒 Security Alert: Your ${BRAND_NAME} Password Was Changed`,
    message: `Hi ${userName}, your account password was successfully changed. If this wasn't you, please contact support immediately.`,
    html: getPasswordChangedAlertHtml(userName, userEmail),
  }).catch((err) => {
    console.error(`❌ [Email Trigger Failed] Event: PasswordChanged, Error: ${err.message}`);
  });
};

/**
 * Dispatch Low Stock Alert email to nursery vendor
 */
export const sendLowStockAlert = async (
  nurseryEmail: string,
  nurseryName: string,
  productName: string,
  currentStock: number,
  threshold: number = 5
) => {
  return sendEmail({
    email: nurseryEmail,
    subject: currentStock <= 0
      ? `🚨 [OUT OF STOCK] ${productName} — Restock Urgently`
      : `⚠️ [LOW STOCK] ${productName} — Only ${currentStock} Left`,
    message: `${nurseryName}, your product "${productName}" has ${currentStock} unit(s) remaining (threshold: ${threshold}). Please restock soon.`,
    html: getLowStockAlertHtml(nurseryName, productName, currentStock, threshold),
  }).catch((err) => {
    console.error(`❌ [Email Trigger Failed] Event: LowStockAlert, Error: ${err.message}`);
  });
};



/**
 * Dispatch Forgot Password / Recovery Email to user.
 *
 * Uses the polished getPasswordResetHtml template from this module.
 * Returns the raw EmailResult directly so the caller can inspect result.success
 * and handle token cleanup on SMTP failure.
 *
 * Does NOT use .catch() swallowing - caller MUST check result.success
 * so it can clear the DB token and return 500 on delivery failure.
 */
export const sendForgotPasswordEmail = async (
  userEmail: string,
  userName: string,
  resetUrl: string
) => {
  return sendEmail({
    email: userEmail,
    subject: 'Reset Your ' + BRAND_NAME + ' Password',
    message: 'Hi ' + userName + ', reset your password using this link (valid 15 minutes): ' + resetUrl + '\n\nIf you did not request this, please ignore this email.',
    html: getPasswordResetHtml(userName, resetUrl, 15),
    type: "PASSWORD_RESET",
  });
};


// ======================================================================
// 📦 BULK ORDERS & B2B INQUIRY TEMPLATES & DISPATCHERS
// ======================================================================

export interface BulkOrderEmailData {
  _id?: string;
  fullName: string;
  phoneNumber: string;
  email?: string;
  city: string;
  state: string;
  productType: string;
  estimatedQuantity: number | string;
  message?: string;
  status?: string;
  createdAt?: Date | string;
}

/**
 * Super Admin: New Bulk Order Inquiry Alert
 */
export const getAdminBulkOrderNotificationHtml = (order: BulkOrderEmailData): string => {
  const inquiryId = order._id ? order._id.toString() : 'NEW';
  const createdDate = order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN') : new Date().toLocaleString('en-IN');
  const adminDashboardUrl = `${FRONTEND_URL}/admin/bulk-orders`;

  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #dbeafe; color: #1e40af; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        🏢 Corporate / B2B Inquiry
      </span>
      <h1 style="color: #0f172a; font-size: 22px; font-weight: 800; margin: 12px 0 6px 0;">
        New Bulk Order Inquiry Received
      </h1>
      <p style="color: #64748b; font-size: 14px; margin: 0;">
        A new enterprise inquiry has been submitted and is awaiting commercial review.
      </p>
    </div>

    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; color: #64748b; font-weight: 600; width: 35%;">Inquiry ID:</td>
        <td style="padding: 10px 0; color: #0f172a; font-family: monospace; font-weight: 700;">#${inquiryId}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Client Name:</td>
        <td style="padding: 10px 0; color: #0f172a; font-weight: 700;">${order.fullName}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Contact Phone:</td>
        <td style="padding: 10px 0; color: #0f172a; font-weight: 700;">${order.phoneNumber}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Email Address:</td>
        <td style="padding: 10px 0; color: #0f172a;">${order.email || '<span style="color: #94a3b8;">Not provided</span>'}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Location:</td>
        <td style="padding: 10px 0; color: #0f172a;">${order.city}, ${order.state}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Product Category:</td>
        <td style="padding: 10px 0; color: #15803d; font-weight: 700; text-transform: capitalize;">${order.productType}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Estimated Quantity:</td>
        <td style="padding: 10px 0; color: #0f172a; font-weight: 700;">${order.estimatedQuantity} units</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Date Submitted:</td>
        <td style="padding: 10px 0; color: #64748b;">${createdDate}</td>
      </tr>
    </table>

    <div style="background-color: #f8fafc; border-left: 4px solid #15803d; padding: 14px 16px; border-radius: 6px; margin-bottom: 24px;">
      <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: 700; color: #334155;">Customer Message & Requirements:</p>
      <p style="margin: 0; font-size: 14px; color: #475569; line-height: 1.5; white-space: pre-wrap;">${order.message ? order.message : '<em style="color: #94a3b8;">No additional message specified.</em>'}</p>
    </div>

    <div style="text-align: center; margin: 28px 0 10px 0;">
      <a href="${adminDashboardUrl}" target="_blank" style="background-color: #15803d; color: #ffffff; padding: 12px 28px; font-size: 14px; font-weight: 700; text-decoration: none; border-radius: 8px; display: inline-block;">
        View in Admin Dashboard &rarr;
      </a>
    </div>
  `;

  return baseEmailWrapper({
    title: `New Bulk Order Inquiry from ${order.fullName} — ${BRAND_NAME}`,
    preheader: `Bulk order inquiry for ${order.estimatedQuantity} ${order.productType} in ${order.city}.`,
    bodyHtml,
  });
};

/**
 * Customer: Bulk Order Inquiry Acknowledgment Confirmation
 */
export const getBulkOrderReceivedHtml = (order: BulkOrderEmailData): string => {
  const inquiryId = order._id ? order._id.toString() : 'PENDING';

  const bodyHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="background-color: #dcfce7; color: #166534; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        🌱 Inquiry Confirmed
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        We Received Your Bulk Order Request!
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 auto; max-width: 480px;">
        Hi <strong>${order.fullName}</strong>, thank you for your interest in partnering with ${BRAND_NAME}. Our commercial team is currently reviewing your project requirements.
      </p>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 14px 0; font-size: 15px; color: #0f172a; font-weight: 700; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">
        Inquiry Summary
      </h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="padding: 6px 0; color: #64748b; width: 40%;">Inquiry Reference:</td>
          <td style="padding: 6px 0; color: #0f172a; font-family: monospace; font-weight: 700;">#${inquiryId}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Selected Category:</td>
          <td style="padding: 6px 0; color: #15803d; font-weight: 700; text-transform: capitalize;">${order.productType}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Estimated Quantity:</td>
          <td style="padding: 6px 0; color: #0f172a; font-weight: 700;">${order.estimatedQuantity} units</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Delivery Destination:</td>
          <td style="padding: 6px 0; color: #0f172a;">${order.city}, ${order.state}</td>
        </tr>
      </table>
    </div>

    <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 14px 16px; border-radius: 6px; margin-bottom: 24px; font-size: 13px; color: #065f46; line-height: 1.6;">
      <strong>What happens next?</strong><br/>
      A dedicated commercial account manager will reach out via phone (<strong>${order.phoneNumber}</strong>) or email within <strong>24 business hours</strong> with personalized pricing, nursery availability, and logistics timelines.
    </div>

    <p style="font-size: 13px; color: #64748b; text-align: center; margin: 0;">
      Need immediate assistance? Feel free to reach out directly to our commercial team at <a href="mailto:${getEmailConfig().fromEmail || getEmailConfig().user || 'support@urbannursery.com'}" style="color: #15803d; font-weight: 600;">${getEmailConfig().fromEmail || getEmailConfig().user || 'support@urbannursery.com'}</a>.
    </p>
  `;

  return baseEmailWrapper({
    title: `Bulk Order Request Received — ${BRAND_NAME}`,
    preheader: `We received your bulk order request for ${order.estimatedQuantity} units.`,
    bodyHtml,
  });
};

/**
 * Non-blocking dispatchers for Bulk Order events
 */
export const sendAdminBulkOrderAlert = async (order: BulkOrderEmailData) => {
  const adminEmail = process.env.ADMIN_EMAIL || getEmailConfig().user;
  if (!adminEmail) return;

  return sendEmail({
    email: adminEmail,
    subject: `🏢 [New Bulk Order] ${order.fullName} (${order.estimatedQuantity} ${order.productType}) — ${BRAND_NAME}`,
    message: `New bulk order inquiry from ${order.fullName}. Phone: ${order.phoneNumber}, City: ${order.city}, Quantity: ${order.estimatedQuantity} units.`,
    html: getAdminBulkOrderNotificationHtml(order),
  }).catch((err) => {
    console.error(`❌ [Email Trigger Failed] Event: AdminBulkOrderAlert, Error: ${err?.message || err}`);
  });
};

export const sendCustomerBulkOrderConfirmation = async (order: BulkOrderEmailData) => {
  if (!order.email || !order.email.trim()) return;

  return sendEmail({
    email: order.email.trim(),
    subject: `🌱 Bulk Order Inquiry Confirmed — ${BRAND_NAME}`,
    message: `Hi ${order.fullName}, we have received your bulk order request for ${order.estimatedQuantity} units. Our commercial manager will reach out within 24 hours.`,
    html: getBulkOrderReceivedHtml(order),
  }).catch((err) => {
    console.error(`❌ [Email Trigger Failed] Event: CustomerBulkOrderConfirmation, Error: ${err?.message || err}`);
  });
};

// ======================================================================
// 🔄 3-WAY TRANSACTIONAL NOTIFICATION TEMPLATES (CUSTOMER, NURSERY, ADMIN)
// ======================================================================

export interface CustomerDecisionEmailData {
  customerName: string;
  orderId: string;
  requestId: string;
  requestType: "Return" | "Replacement" | string;
  status: "Approved" | "Rejected" | "Completed" | string;
  productName: string;
  productImage?: string;
  reason: string;
  adminRemarks?: string;
}

/**
 * Template A: Customer Decision Email
 */
export const getReturnReplacementCustomerDecisionHtml = (
  data: CustomerDecisionEmailData
): string => {
  const isApproved = data.status === "Approved";
  const isRejected = data.status === "Rejected";
  const isCompleted = data.status === "Completed";

  const badgeBg = isApproved ? "#dcfce7" : isRejected ? "#fee2e2" : "#dbeafe";
  const badgeColor = isApproved ? "#15803d" : isRejected ? "#b91c1c" : "#1d4ed8";
  const badgeBorder = isApproved ? "#86efac" : isRejected ? "#fca5a5" : "#93c5fd";
  const badgeText = isApproved
    ? `✅ ${data.requestType} Approved`
    : isRejected
    ? `❌ Claim Declined`
    : `✨ ${data.requestType} Completed`;

  const nextStepsText = isApproved
    ? data.requestType === "Replacement"
      ? "Our nursery partner is preparing a healthy, vibrant replacement unit. Our courier partner will contact you for delivery (and reverse pickup if needed) within 24–48 hours."
      : "Your return claim has been approved. The refund has been initiated to your original payment method / wallet and will reflect within 3–5 business days."
    : isRejected
    ? "Our botanical support team evaluated the unboxing photographs and found that the plant's condition falls within natural transit acclimation shock or outside our 24-hour guarantee policy. Please consult our plant care guides for nurturing tips."
    : "Your claim has been fully processed and marked completed.";

  const bodyHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="display: inline-block; background-color: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        ${badgeText}
      </span>
      <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 14px 0 8px 0;">
        Update on your ${data.requestType} Request
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 auto; max-width: 520px;">
        Hi <strong>${data.customerName}</strong>, your botanical guarantee request for Order <strong>#${data.orderId}</strong> has been evaluated by our central botanical team.
      </p>
    </div>

    <!-- Product & Claim Details Box -->
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; font-size: 14px; color: #334155;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          ${
            data.productImage
              ? `<td style="width: 60px; vertical-align: top; padding-right: 14px;">
                  <img src="${data.productImage}" alt="${data.productName}" style="width: 56px; height: 56px; border-radius: 8px; object-fit: cover; border: 1px solid #cbd5e1;" />
                </td>`
              : ""
          }
          <td style="vertical-align: top;">
            <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 700; color: #0f172a;">${data.productName}</p>
            <p style="margin: 0 0 4px 0; font-size: 13px; color: #64748b;"><strong>Claim Type:</strong> ${data.requestType} | <strong>Claim ID:</strong> #${data.requestId.slice(-6).toUpperCase()}</p>
            <p style="margin: 0; font-size: 13px; color: #64748b;"><strong>Reported Issue:</strong> ${data.reason}</p>
          </td>
        </tr>
      </table>

      ${
        data.adminRemarks
          ? `<div style="background-color: #ffffff; border-left: 4px solid ${badgeColor}; padding: 12px 16px; border-radius: 6px; margin-top: 14px; border-top: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 12px; font-weight: 700; text-transform: uppercase; color: ${badgeColor};">Botanical Team Remarks:</p>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: #1e293b; font-style: italic; line-height: 1.5;">"${data.adminRemarks}"</p>
            </div>`
          : ""
      }
    </div>

    <!-- Next Steps Highlight -->
    <div style="background-color: ${isApproved ? "#f0fdf4" : isRejected ? "#fef2f2" : "#f0f9ff"}; border: 1px solid ${badgeBorder}; border-radius: 12px; padding: 18px 20px; margin: 20px 0; font-size: 13px; line-height: 1.6; color: #334155;">
      <p style="margin: 0 0 6px 0; font-size: 14px; font-weight: 700; color: ${badgeColor};">Next Steps:</p>
      <p style="margin: 0;">${nextStepsText}</p>
    </div>

    ${infoBadgeBox("🌿", "Urban Nursery Botanical Guarantee", "We stand behind the health and vigor of our plants. Every request is reviewed by verified horticulturists.")}

    ${ctaButton("View Order Details", `${FRONTEND_URL}/orders/${data.orderId}`)}
  `;

  return baseEmailWrapper({
    title: `Update on your ${data.requestType} Request - Order #${data.orderId}`,
    preheader: `Your ${data.requestType} request for ${data.productName} has been ${data.status.toLowerCase()}.`,
    bodyHtml,
  });
};

export interface NurseryActionEmailData {
  nurseryName: string;
  orderId: string;
  requestId: string;
  requestType: "Return" | "Replacement" | string;
  status: "Approved" | "Rejected" | "Completed" | string;
  productName: string;
  customerCity?: string;
  customerState?: string;
  reason: string;
  description?: string;
  adminRemarks?: string;
}

/**
 * Template B: Nursery Partner Action Email
 */
export const getReturnReplacementNurseryActionHtml = (
  data: NurseryActionEmailData
): string => {
  const isApproved = data.status === "Approved";
  const isReplacement = data.requestType === "Replacement";

  const bannerBg = isApproved ? "#dcfce7" : "#f1f5f9";
  const bannerColor = isApproved ? "#15803d" : "#475569";
  const bannerText = isApproved
    ? isReplacement
      ? "⚠️ ACTION REQUIRED: Replacement Approved by Admin"
      : "ℹ️ NOTICE: Return & Refund Approved by Admin"
    : `CLAIM DECISION: ${data.status.toUpperCase()}`;

  const actionInstruction = isApproved
    ? isReplacement
      ? `<strong>Action Required:</strong> Please prepare 1 unit of healthy, premium stock of <strong>${data.productName}</strong>. Hydrate and securely pack the plant following Urban Nursery's eco-transit standards. Our integrated courier partner will initiate reverse/replacement transit within 24 hours.`
      : `<strong>Notice:</strong> Central Admin has approved a return/refund for <strong>${data.productName}</strong>. The marketplace commission and payout ledger have been adjusted accordingly. No replacement dispatch is needed.`
    : `<strong>Notice:</strong> Central Botanical Support evaluated the customer report and determined that the claim is <strong>Rejected</strong>. No replacement stock or refund deduction is required from your nursery.`;

  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="display: inline-block; background-color: ${bannerBg}; color: ${bannerColor}; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        ${bannerText}
      </span>
      <h1 style="color: #0f172a; font-size: 22px; font-weight: 800; margin: 14px 0 8px 0;">
        Merchant Action Notice: Claim #${data.requestId.slice(-6).toUpperCase()}
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        Hi <strong>${data.nurseryName}</strong>, Central Admin has evaluated customer claim <strong>#${data.requestId.slice(-6).toUpperCase()}</strong> for Order <strong>#${data.orderId}</strong>.
      </p>
    </div>

    <!-- Claim & Item Card -->
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; font-size: 14px; color: #334155;">
      <p style="margin: 0 0 6px 0;"><strong>Product:</strong> ${data.productName}</p>
      <p style="margin: 0 0 6px 0;"><strong>Request Type:</strong> ${data.requestType}</p>
      <p style="margin: 0 0 6px 0;"><strong>Customer Reported Reason:</strong> ${data.reason}</p>
      ${data.description ? `<p style="margin: 0 0 6px 0;"><strong>Customer Comment:</strong> <em>"${data.description}"</em></p>` : ""}
      ${data.customerCity ? `<p style="margin: 0 0 6px 0;"><strong>Customer Location:</strong> ${data.customerCity}${data.customerState ? `, ${data.customerState}` : ""}</p>` : ""}
      <p style="margin: 0;"><strong>Resolution Status:</strong> <span style="color: ${bannerColor}; font-weight: 700;">${data.status}</span></p>

      ${
        data.adminRemarks
          ? `<div style="background-color: #ffffff; border-left: 4px solid #16a34a; padding: 12px 14px; border-radius: 6px; margin-top: 14px; border-top: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">
              <strong>Admin Resolution Instructions:</strong><br/>
              <span style="color: #1e293b; font-style: italic;">"${data.adminRemarks}"</span>
            </div>`
          : ""
      }
    </div>

    <!-- Specific Action Box -->
    <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 16px 18px; border-radius: 8px; margin: 20px 0; font-size: 13px; color: #065f46; line-height: 1.6;">
      ${actionInstruction}
    </div>

    ${ctaButton("Open Nursery Returns Dashboard", `${FRONTEND_URL}/nursery/return-replacement-requests`)}
  `;

  return baseEmailWrapper({
    title: `[Action Required] ${data.requestType} Request #${data.requestId.slice(-6).toUpperCase()} for Order #${data.orderId}`,
    preheader: `Claim #${data.requestId.slice(-6).toUpperCase()} for Order #${data.orderId} marked as ${data.status}.`,
    bodyHtml,
  });
};

export interface AdminAuditEmailData {
  requestId: string;
  orderId: string;
  status: string;
  requestType: string;
  customerName: string;
  customerEmail: string;
  nurseryName: string;
  productName: string;
  reason: string;
  adminRemarks?: string;
}

/**
 * Template C: Admin Log Notification Email
 */
export const getReturnReplacementAdminAuditHtml = (
  data: AdminAuditEmailData
): string => {
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const bodyHtml = `
    <div style="margin-bottom: 24px;">
      <span style="background-color: #e0f2fe; color: #0369a1; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
        🛡️ SYSTEM AUDIT LOG
      </span>
      <h1 style="color: #0f172a; font-size: 22px; font-weight: 800; margin: 14px 0 8px 0;">
        Claim #${data.requestId.slice(-6).toUpperCase()} Status Changed: ${data.status}
      </h1>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        An administrator has updated the resolution status for <strong>${data.requestType}</strong> claim on Order <strong>#${data.orderId}</strong>.
      </p>
    </div>

    <!-- Snapshot Audit Table -->
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; font-size: 14px; color: #334155;">
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #64748b; width: 140px;">Claim ID:</td>
          <td style="padding: 6px 0; font-weight: 700; color: #0f172a;">#${data.requestId}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Order ID:</td>
          <td style="padding: 6px 0; font-weight: 700; color: #0f172a;">#${data.orderId}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Resolution Status:</td>
          <td style="padding: 6px 0; font-weight: 700; color: #15803d;">${data.status}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Claim Type:</td>
          <td style="padding: 6px 0; color: #0f172a;">${data.requestType}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Product:</td>
          <td style="padding: 6px 0; color: #0f172a;">${data.productName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Customer:</td>
          <td style="padding: 6px 0; color: #0f172a;">${data.customerName} (${data.customerEmail})</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Fulfilling Nursery:</td>
          <td style="padding: 6px 0; color: #0f172a;">${data.nurseryName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Stated Issue:</td>
          <td style="padding: 6px 0; color: #0f172a;">${data.reason}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b;">Audit Timestamp:</td>
          <td style="padding: 6px 0; color: #0f172a;">${timestamp} IST</td>
        </tr>
        ${
          data.adminRemarks
            ? `<tr>
                <td style="padding: 6px 0; color: #64748b; vertical-align: top;">Admin Remarks:</td>
                <td style="padding: 6px 0; color: #0f172a; font-style: italic;">"${data.adminRemarks}"</td>
              </tr>`
            : ""
        }
      </table>
    </div>

    ${ctaButton("Open Admin Returns Management", `${FRONTEND_URL}/admin/return-replacement-requests`)}
  `;

  return baseEmailWrapper({
    title: `[Audit] Claim #${data.requestId.slice(-6).toUpperCase()} marked as ${data.status}`,
    preheader: `Audit log for Claim #${data.requestId.slice(-6).toUpperCase()} (${data.status}).`,
    bodyHtml,
  });
};

