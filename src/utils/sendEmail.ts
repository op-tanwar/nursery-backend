import nodemailer, { Transporter } from "nodemailer";
import { EmailOptions, EmailResult } from "../types/email.types";

export { EmailOptions, EmailResult };

let transporter: Transporter | null = null;

/**
 * Normalizes email configuration across diverse environment variable conventions.
 * Supports Render, Docker, Heroku, AWS, and local development setups.
 */
export const getEmailConfig = () => {
  const service = (
    process.env.SMTP_SERVICE ||
    process.env.EMAIL_SERVICE ||
    ""
  ).trim().toLowerCase();

  const host = (
    process.env.SMTP_HOST ||
    process.env.EMAIL_HOST ||
    process.env.MAIL_HOST ||
    "smtp.gmail.com"
  ).trim().replace(/^["']|["']$/g, "");

  // Strip any accidental whitespace or wrapping quotes from credentials
  const user = (
    process.env.SMTP_USER ||
    process.env.SMTP_MAIL ||
    process.env.EMAIL_USER ||
    process.env.GMAIL_USER ||
    process.env.MAIL_USER ||
    process.env.MAIL_USERNAME ||
    process.env.EMAIL ||
    ""
  ).trim().replace(/^["']|["']$/g, "");

  const pass = (
    process.env.SMTP_PASS ||
    process.env.SMTP_PASSWORD ||
    process.env.EMAIL_PASSWORD ||
    process.env.EMAIL_PASS ||
    process.env.GMAIL_PASS ||
    process.env.GMAIL_APP_PASSWORD ||
    process.env.MAIL_PASSWORD ||
    ""
  ).trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");

  const isGmail =
    service === "gmail" ||
    host.toLowerCase().includes("gmail.com") ||
    user.toLowerCase().endsWith("@gmail.com");

  const isCloudPlatform = Boolean(
    process.env.RENDER ||
    process.env.IS_RENDER ||
    process.env.DYNO ||
    process.env.VERCEL ||
    process.env.AWS_REGION
  );

  // Cloud providers (especially Render) frequently drop or block outbound port 587 (STARTTLS).
  // When using Gmail or running on Render, default to Port 465 (Direct SSL) unless explicitly set otherwise.
  const rawPort = process.env.SMTP_PORT || process.env.EMAIL_PORT || process.env.MAIL_PORT;
  let port: number;
  if (rawPort && !isNaN(Number(rawPort))) {
    port = Number(rawPort);
  } else if (isGmail || isCloudPlatform) {
    port = 465;
  } else {
    port = 587;
  }

  // Force secure=true if port is 465; respect explicit boolean env if present
  const explicitSecure = process.env.SMTP_SECURE || process.env.EMAIL_SECURE;
  const secure =
    explicitSecure !== undefined
      ? explicitSecure === "true"
      : port === 465;

  const fromEmail = (
    process.env.SMTP_FROM_EMAIL ||
    process.env.FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    process.env.SMTP_FROM ||
    user ||
    "support@urbannursery.com"
  ).trim().replace(/^["']|["']$/g, "");

  const fromName = (
    process.env.SMTP_FROM_NAME ||
    process.env.EMAIL_FROM_NAME ||
    process.env.APP_NAME ||
    "Urban Nursery"
  ).trim().replace(/^["']|["']$/g, "");

  const adminEmail = (
    process.env.ADMIN_NOTIFICATION_EMAIL ||
    process.env.ADMIN_ALERT_EMAIL ||
    process.env.ADMIN_EMAIL ||
    user ||
    "admin@urbannursery.com"
  ).trim().replace(/^["']|["']$/g, "");

  return {
    service,
    host,
    port,
    secure,
    user,
    pass,
    fromEmail,
    fromName,
    adminEmail,
    isGmail,
    isCloudPlatform,
    isConfigured: Boolean(user && pass),
  };
};

/**
 * Builds resilient transport options for a given configuration and port.
 * Pooling is strictly disabled (pool: false) on serverless/cloud containers so stale connections are never reused.
 */
const buildTransportOptions = (
  config: ReturnType<typeof getEmailConfig>,
  targetPort: number = config.port
) => {
  const is587 = targetPort === 587;
  const is465 = targetPort === 465;

  return {
    host: config.host || "smtp.gmail.com",
    port: targetPort,
    secure: is465, // Port 465 = Direct SSL, Port 587 = STARTTLS
    requireTLS: is587, // Enforce STARTTLS handshake on port 587
    auth: {
      user: config.user,
      pass: config.pass,
    },
    tls: {
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
    },
    pool: false, // Pooling strictly disabled on serverless/cloud containers
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  };
};

/**
 * Initializes or retrieves the singleton Nodemailer transporter
 */
export const getTransporter = (): Transporter => {
  const config = getEmailConfig();

  if (!config.isConfigured) {
    console.warn("⚠️ [Nodemailer] SMTP credentials (EMAIL_USER/SMTP_USER and EMAIL_PASSWORD/SMTP_PASS) are not configured.");
  }

  if (!transporter) {
    try {
      const options = buildTransportOptions(config);
      transporter = nodemailer.createTransport(options as any);
    } catch (error: any) {
      console.error("❌ [Nodemailer] Transporter creation failed:", error?.message || error);
      throw error;
    }
  }

  return transporter;
};

/**
 * Reset transporter cache (e.g., on connection errors or credential reloads)
 */
export const resetTransporter = (): void => {
  transporter = null;
};

/**
 * Helper to extract standardized error diagnostics from SMTP / network errors
 */
export const formatEmailError = (
  error: any
): { message: string; code?: string; responseCode?: number; command?: string; stack?: string } => {
  return {
    message: error?.message || String(error),
    code: error?.code,
    responseCode: error?.responseCode,
    command: error?.command,
    stack: error?.stack,
  };
};

/**
 * Connection verification executed on server startup with auto-fallback probe
 */
export const verifyEmailConnection = async (): Promise<boolean> => {
  const config = getEmailConfig();

  console.log("\n=======================================================");
  console.log("📧 [Nodemailer] Verifying Urban Nursery SMTP Email Pipeline...");
  console.log(`   Host:     ${config.host}`);
  console.log(`   Port:     ${config.port} (Secure: ${config.secure})`);
  console.log(`   Service:  ${config.service || (config.isGmail ? "gmail (auto-detected)" : "custom")}`);
  console.log(`   Platform: ${config.isCloudPlatform ? "Cloud Container (Render/AWS)" : "Standard"}`);
  console.log(`   User:     ${config.user ? config.user.replace(/(.{3}).*(@.*)/, "$1***$2") : "(Not Provided)"}`);
  console.log(`   Sender:   "${config.fromName}" <${config.fromEmail}>`);
  console.log(`   Admin:    ${config.adminEmail}`);

  if (!config.isConfigured) {
    console.warn("⚠️ [Nodemailer] WARNING: SMTP credentials missing in environment variables.");
    console.warn("   Required in Render Dashboard: SMTP_USER (or EMAIL_USER) and SMTP_PASS (or EMAIL_PASSWORD).");
    console.warn("   Emails will fail safely without crashing HTTP requests.");
    console.log("=======================================================\n");
    return false;
  }

  // Probe 1: Primary Transporter
  try {
    const t = getTransporter();
    await t.verify();
    console.log("✅ SMTP Server is ready to send messages");
    console.log("=======================================================\n");
    return true;
  } catch (error: any) {
    console.error("❌ CRITICAL: SMTP Transport verification failed:", error?.message || error);
    console.error(
      `   ↳ Code: ${error?.code || "N/A"} | ResponseCode: ${error?.responseCode || "N/A"} | Command: ${error?.command || "N/A"}`
    );

    // If authentication error, no need to retry with different ports
    if (error.code === "EAUTH" || error.responseCode === 535) {
      console.error(
        "   ↳ Reason: Invalid username or password. Ensure you are using a 16-character Google App Password (not your account password)."
      );
      console.log("=======================================================\n");
      resetTransporter();
      return false;
    }

    // Probe 2: Automatic Fallback: If port 465 fails, immediately fall back to port 587 (secure: false, requireTLS: true); or vice versa
    const fallbackPort = config.port === 465 ? 587 : 465;
    try {
      console.log(`   ↳ Probing fallback transport (Port ${fallbackPort} ${fallbackPort === 587 ? "STARTTLS" : "Direct SSL"})...`);
      const fallbackOptions = buildTransportOptions(config, fallbackPort);
      const fallbackTransporter = nodemailer.createTransport(fallbackOptions as any);
      await fallbackTransporter.verify();

      console.log(`✅ SMTP Server is ready to send messages (via Fallback Port ${fallbackPort})`);
      console.log("=======================================================\n");
      transporter = fallbackTransporter;
      return true;
    } catch (fallbackError: any) {
      console.error(
        `❌ CRITICAL: SMTP Transport verification failed on both primary (Port ${config.port}) and fallback (Port ${fallbackPort}):`,
        fallbackError.message || fallbackError
      );
      console.error(
        `   ↳ Fallback Code: ${fallbackError?.code || "N/A"} | Response: ${fallbackError?.response || "N/A"} | Command: ${fallbackError?.command || "N/A"}`
      );
      console.warn("   ↳ Action required on Render: Verify SMTP_USER & SMTP_PASSWORD.");
      console.log("=======================================================\n");
      resetTransporter();
      return false;
    }
  }
};

const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Core sendEmail utility with Dual-Stage Auto-Recovery & Cloud Port-Unblocking.
 *
 * Execution Model:
 * 1. Checks email validity and configuration.
 * 2. Stage 1: Dispatches through primary transporter (Port 465 or configured port).
 * 3. Stage 2 (Auto-Recovery): If connection times out or fails with socket hang up / network errors
 *    (common on Render when port 465 or 587 is blocked/hung), immediately falls back to alternate
 *    Port 587 (STARTTLS with requireTLS: true) or Port 465 (Direct SSL) within the same request.
 * 4. Never crashes the calling thread. Returns EmailResult with diagnostic details.
 */
export const sendEmail = async (options: EmailOptions): Promise<EmailResult> => {
  const config = getEmailConfig();
  const emailType = options.type || "TRANSACTIONAL";

  if (!options.email || !isValidEmail(options.email)) {
    const err = `Invalid or missing recipient email: "${options.email}"`;
    console.error(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email || "undefined"} | Error: ${err}`);
    return { success: false, error: err, code: "EINVALIDEMAIL" };
  }

  if (!options.subject) {
    const err = "Email subject is required";
    console.error(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email} | Error: ${err}`);
    return { success: false, error: err, code: "ENOSUBJECT" };
  }

  if (!config.isConfigured) {
    const warn = `Email not sent to ${options.email} because SMTP credentials are not configured in Render environment variables. Set SMTP_USER & SMTP_PASSWORD. (Subject: "${options.subject}")`;
    console.warn(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email} | Error: ${warn}`);
    return { success: false, error: warn, code: "ECONFIG" };
  }

  const fromAddress = `"${config.fromName}" <${config.fromEmail}>`;
  const mailOptions = {
    from: fromAddress,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html || options.message,
    replyTo: options.replyTo || config.fromEmail,
    cc: options.cc,
    bcc: options.bcc,
    attachments: options.attachments,
  };

  // ── STAGE 1: Primary Transporter Attempt ──
  try {
    const emailTransporter = getTransporter();
    const info = await emailTransporter.sendMail(mailOptions);
    console.log(`[EMAIL SUCCESS] Type: ${emailType} | Recipient: ${options.email} | Subject: "${options.subject}" | ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (primaryError: any) {
    const primaryMsg = primaryError?.message || primaryError?.response || "Unknown primary SMTP error";
    const primaryCode = primaryError?.code;

    // Fast-fail if authentication is rejected (EAUTH / 535) — wrong password cannot be fixed by retrying ports
    if (primaryCode === "EAUTH" || primaryError?.responseCode === 535) {
      resetTransporter();
      const authErr = "SMTP Authentication Failed (535). Please verify your SMTP_USER and 16-character Google App Password in Render Dashboard.";
      console.error(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email} | Error: ${authErr}`);
      console.error(`   ↳ Code: ${primaryCode} | ResponseCode: ${primaryError?.responseCode} | Command: ${primaryError?.command || "N/A"}`);
      return {
        success: false,
        error: authErr,
        code: primaryCode,
        response: primaryError?.response,
        responseCode: primaryError?.responseCode,
        command: primaryError?.command,
      };
    }

    const fallbackPort = config.port === 465 ? 587 : 465;
    console.warn(
      `⚠️ [Nodemailer] Primary send attempt failed for ${options.email} (Port: ${config.port}, Code: ${primaryCode || "N/A"}: ${primaryMsg}). Immediately falling back to Port ${fallbackPort} (${fallbackPort === 587 ? "STARTTLS" : "Direct SSL"})...`
    );

    // ── STAGE 2: Auto-Recovery Fallback (Dual-Port Fallback: 465 <-> 587) ──
    try {
      resetTransporter();

      const fallbackOptions = buildTransportOptions(config, fallbackPort);
      const fallbackTransporter = nodemailer.createTransport(fallbackOptions as any);
      const info = await fallbackTransporter.sendMail(mailOptions);

      console.log(
        `[EMAIL SUCCESS] Type: ${emailType} | Recipient: ${options.email} | Subject: "${options.subject}" | ID: ${info.messageId} (Delivered via Fallback Port ${fallbackPort})`
      );

      // Cache the successful fallback transporter
      transporter = fallbackTransporter;
      return { success: true, messageId: info.messageId };
    } catch (fallbackError: any) {
      const fallbackMsg = fallbackError?.response || fallbackError?.message || primaryMsg;
      console.error(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email} | Error: ${fallbackMsg}`);
      console.error(
        `   ↳ Primary Failure (Port ${config.port}):   ${primaryMsg} (Code: ${primaryCode || "N/A"}, Response: ${primaryError?.response || "N/A"}, Command: ${primaryError?.command || "N/A"})`
      );
      console.error(
        `   ↳ Fallback Failure (Port ${fallbackPort}):  ${fallbackError?.message} (Code: ${fallbackError?.code || "N/A"}, Response: ${fallbackError?.response || "N/A"}, Command: ${fallbackError?.command || "N/A"})`
      );
      console.error(`   ↳ Diagnostic Info:   Target Host=${config.host}:${config.port}, User=${config.user ? config.user.replace(/(.{3}).*(@.*)/, "$1***$2") : "EMPTY"}, Cloud=${config.isCloudPlatform}`);
      
      resetTransporter();
      return {
        success: false,
        error: fallbackMsg,
        code: fallbackError?.code || primaryCode,
        response: fallbackError?.response || primaryError?.response,
        responseCode: fallbackError?.responseCode || primaryError?.responseCode,
        command: fallbackError?.command || primaryError?.command,
      };
    }
  }
};

export default sendEmail;