import express, { Request, Response } from "express";
import validator from "validator";
import mongoose from "mongoose";
import sendEmail, { getEmailConfig } from "../utils/sendEmail";

const router = express.Router();

// ======================================================================
// 🏥 1. GENERAL HEALTH CHECK (DATABASE + EMAIL ENGINE READINESS)
// ======================================================================
router.get("/", (_req: Request, res: Response) => {
  const config = getEmailConfig();
  const dbStatus = mongoose.connection.readyState;
  const isDbHealthy = dbStatus === 1;

  res.status(isDbHealthy ? 200 : 503).json({
    success: isDbHealthy,
    status: isDbHealthy ? "UP" : "DOWN",
    database: isDbHealthy ? "CONNECTED" : "DISCONNECTED",
    emailEngine: {
      activeProvider: config.activeProvider,
      protocol: config.hasHttpApi ? "HTTPS REST API (Port 443 — Zero Port Blocking)" : "SMTP TCP",
      isConfigured: config.isConfigured,
      sender: `${config.fromName} <${config.fromEmail}>`,
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ======================================================================
// 🧪 2. LIVE PRODUCTION EMAIL DIAGNOSTIC ENDPOINT
// ======================================================================
/**
 * Live test route to verify email delivery from Render in real-time.
 * Endpoint: GET /api/v1/health/test-email?to=<email>&secret=<JWT_SECRET_OR_ADMIN_SECRET>
 */
router.get("/test-email", async (req: Request, res: Response) => {
  const querySecret = typeof req.query.secret === "string" ? req.query.secret.trim() : "";
  const queryTo = typeof req.query.to === "string" ? req.query.to.trim() : "";

  // 1. Authenticate Request via Secret
  const validSecrets = [
    process.env.JWT_SECRET,
    process.env.ADMIN_SECRET,
    process.env.ADMIN_DIAGNOSTIC_SECRET,
  ].filter(Boolean) as string[];

  const isAuthorized =
    Boolean(querySecret) &&
    validSecrets.some((s) => s.trim() === querySecret);

  if (!isAuthorized) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Diagnostic endpoint requires valid secret parameter matching JWT_SECRET or ADMIN_SECRET.",
    });
  }

  // 2. Validate Target Recipient
  if (!queryTo || !validator.isEmail(queryTo)) {
    return res.status(400).json({
      success: false,
      message: "Invalid or missing recipient email address. Example: ?to=your@email.com&secret=...",
    });
  }

  const config = getEmailConfig();
  const timestamp = new Date().toISOString();
  const providerLabel = config.activeProvider;
  const transportLabel = config.hasHttpApi
    ? "HTTPS REST API (Port 443 — Zero Port Blocking)"
    : `SMTP TCP (Port ${config.port})`;

  const testSubject = `🧪 [Diagnostic] Urban Nursery Live Email Delivery Test (${providerLabel})`;
  const testHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #f1f5f9;">
        <h1 style="color: #15803d; margin: 0; font-size: 24px; font-weight: 700;">🌿 Urban Nursery / Planto</h1>
        <p style="color: #64748b; font-size: 14px; margin: 6px 0 0 0;">Live Production Diagnostic Subsystem</p>
      </div>
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <h3 style="color: #166534; margin: 0 0 8px 0; font-size: 16px;">✅ Email Engine Verified Successfully</h3>
        <p style="color: #15803d; margin: 0; font-size: 14px; line-height: 1.5;">
          This email confirms that the Urban Nursery dual-provider HTTPS transactional email engine is functioning properly with zero cloud port blocking.
        </p>
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #334155; margin-bottom: 20px;">
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 0; font-weight: 600; color: #475569; width: 140px;">Active Provider:</td>
          <td style="padding: 10px 0; font-family: monospace; color: #0f172a; font-weight: bold;">${providerLabel}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 0; font-weight: 600; color: #475569;">Transport / Port:</td>
          <td style="padding: 10px 0;">${transportLabel}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 0; font-weight: 600; color: #475569;">Sender:</td>
          <td style="padding: 10px 0;">${config.fromName} &lt;${config.fromEmail}&gt;</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 0; font-weight: 600; color: #475569;">Recipient:</td>
          <td style="padding: 10px 0;">${queryTo}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 0; font-weight: 600; color: #475569;">Environment:</td>
          <td style="padding: 10px 0;">${process.env.NODE_ENV || "production"}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 0; font-weight: 600; color: #475569;">Timestamp (UTC):</td>
          <td style="padding: 10px 0;">${timestamp}</td>
        </tr>
      </table>
      <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0; line-height: 1.4;">
        Urban Nursery Automated Diagnostic Probe &bull; Do not reply to this automated message.
      </p>
    </div>
  `;

  // 3. Attempt Email Delivery
  const result = await sendEmail({
    email: queryTo,
    subject: testSubject,
    message: `Urban Nursery live diagnostic email delivered successfully via ${providerLabel} (${transportLabel}) at ${timestamp}.`,
    html: testHtml,
    type: "DIAGNOSTIC_TEST",
  });

  const statusCode = result.success ? 200 : 502;

  return res.status(statusCode).json({
    success: result.success,
    providerUsed: result.providerUsed || config.activeProvider,
    messageId: result.messageId || null,
    errorDetails: result.success
      ? null
      : result.errorDetails || {
          code: result.code || "DELIVERY_FAILED",
          message: result.error || "Email delivery failed",
          providerResponse: result.response || null,
        },
  });
});

export default router;
