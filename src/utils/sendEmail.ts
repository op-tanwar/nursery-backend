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
  ).trim();

  const user = (
    process.env.SMTP_USER ||
    process.env.EMAIL_USER ||
    process.env.GMAIL_USER ||
    process.env.MAIL_USER ||
    process.env.MAIL_USERNAME ||
    process.env.EMAIL ||
    ""
  ).trim();

  // Strip spaces, accidental surrounding quotes, and line breaks from App Passwords
  const pass = (
    process.env.SMTP_PASS ||
    process.env.SMTP_PASSWORD ||
    process.env.EMAIL_PASSWORD ||
    process.env.EMAIL_PASS ||
    process.env.GMAIL_PASS ||
    process.env.GMAIL_APP_PASSWORD ||
    process.env.MAIL_PASSWORD ||
    ""
  ).replace(/[\s"'\r\n]/g, "");

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
    process.env.FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    process.env.SMTP_FROM ||
    user ||
    "support@urbannursery.com"
  ).trim();

  const fromName = (
    process.env.EMAIL_FROM_NAME ||
    process.env.APP_NAME ||
    "Urban Nursery"
  ).trim();

  const adminEmail = (
    process.env.ADMIN_NOTIFICATION_EMAIL ||
    process.env.ADMIN_EMAIL ||
    user ||
    "admin@urbannursery.com"
  ).trim();

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
 * Builds resilient transport options for a given configuration
 */
const buildTransportOptions = (
  config: ReturnType<typeof getEmailConfig>,
  overridePort?: number,
  overrideSecure?: boolean,
  forceService?: string
) => {
  const targetPort = overridePort !== undefined ? overridePort : config.port;
  const targetSecure =
    overrideSecure !== undefined ? overrideSecure : (targetPort === 465 || config.secure);

  // In cloud environments (Render containers), avoid persistent connection pooling
  // because idle container spin-downs sever the pooled TCP socket, causing ECONNRESET/ETIMEDOUT.
  const usePool = !config.isCloudPlatform && process.env.NODE_ENV !== "production";

  // Use Nodemailer's built-in 'service: gmail' if requested or if Gmail SSL is targeted
  if (forceService === "gmail" || (config.isGmail && targetPort === 465)) {
    return {
      service: "gmail",
      auth: {
        user: config.user,
        pass: config.pass,
      },
      tls: {
        rejectUnauthorized: false,
      },
      pool: usePool,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    };
  }

  return {
    host: config.host,
    port: targetPort,
    secure: targetSecure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
    pool: usePool,
    maxConnections: usePool ? 3 : 1,
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
    console.warn("   Required in Render Dashboard: EMAIL_USER (or SMTP_USER) and EMAIL_PASSWORD (or SMTP_PASS).");
    console.warn("   Emails will fail safely without crashing HTTP requests.");
    console.log("=======================================================\n");
    return false;
  }

  // Probe 1: Primary Transporter
  try {
    const t = getTransporter();
    await t.verify();
    console.log("✅ [Nodemailer] Primary SMTP Connection verified! Ready to deliver emails.");
    console.log("=======================================================\n");
    return true;
  } catch (error: any) {
    console.warn(`⚠️ [Nodemailer] Primary SMTP verification failed on port ${config.port}:`, error.message || error);

    // If authentication error, no need to retry with different ports
    if (error.code === "EAUTH" || error.responseCode === 535) {
      console.error("   ↳ Reason: Invalid username or password. Ensure you are using a 16-character Google App Password (not your account password).");
      console.log("=======================================================\n");
      resetTransporter();
      return false;
    }

    // Probe 2: Automatic Fallback (e.g. if Port 587 is blocked by Render firewall, test Port 465 SSL)
    try {
      console.log("   ↳ Probing fallback transport (Port 465 Direct SSL / service: gmail)...");
      const fallbackOptions = config.isGmail
        ? buildTransportOptions(config, 465, true, "gmail")
        : buildTransportOptions(config, config.port === 465 ? 587 : 465, config.port !== 465);

      const fallbackTransporter = nodemailer.createTransport(fallbackOptions as any);
      await fallbackTransporter.verify();

      console.log("✅ [Nodemailer] Fallback SMTP Connection verified successfully! Adopting fallback transport.");
      console.log("=======================================================\n");
      transporter = fallbackTransporter;
      return true;
    } catch (fallbackError: any) {
      console.error("❌ [Nodemailer] Both primary and fallback SMTP connections failed:", fallbackError.message || fallbackError);
      console.warn("   ↳ Action required on Render: Set EMAIL_PORT=465, EMAIL_SECURE=true, and verify EMAIL_USER & EMAIL_PASSWORD.");
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
 * 2. Stage 1: Dispatches through primary transporter.
 * 3. Stage 2 (Auto-Recovery): If connection times out or fails with network errors
 *    (common on Render when port 587 is blocked), immediately retries via fallback
 *    Port 465 Direct SSL / 'service: gmail' within the same request.
 * 4. Never crashes the calling thread. Returns { success: boolean, messageId?: string, error?: string }.
 */
export const sendEmail = async (options: EmailOptions): Promise<EmailResult> => {
  const config = getEmailConfig();
  const emailType = options.type || "TRANSACTIONAL";

  if (!options.email || !isValidEmail(options.email)) {
    const err = `Invalid or missing recipient email: "${options.email}"`;
    console.error(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email || "undefined"} | Error: ${err}`);
    return { success: false, error: err };
  }

  if (!options.subject) {
    const err = "Email subject is required";
    console.error(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email} | Error: ${err}`);
    return { success: false, error: err };
  }

  if (!config.isConfigured) {
    const warn = `Email not sent to ${options.email} because SMTP credentials are not configured in Render environment variables. Set EMAIL_USER & EMAIL_PASSWORD. (Subject: "${options.subject}")`;
    console.warn(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email} | Error: ${warn}`);
    return { success: false, error: warn };
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
      const authErr = "SMTP Authentication Failed (535). Please verify your EMAIL_USER and 16-character Google App Password in Render Dashboard.";
      console.error(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email} | Error: ${authErr}`);
      return { success: false, error: authErr };
    }

    console.warn(
      `⚠️ [Nodemailer] Primary send attempt failed for ${options.email} (Port: ${config.port}, Code: ${primaryCode || "N/A"}: ${primaryMsg}). Initiating Stage 2 Auto-Recovery Fallback...`
    );

    // ── STAGE 2: Auto-Recovery Fallback (Bypasses Render Port 587 Block) ──
    try {
      resetTransporter();

      // If primary was on 587 or custom port, switch to Port 465 SSL / 'service: gmail'
      const fallbackOptions = config.isGmail
        ? buildTransportOptions(config, 465, true, "gmail")
        : buildTransportOptions(config, config.port === 465 ? 587 : 465, config.port !== 465);

      const fallbackTransporter = nodemailer.createTransport(fallbackOptions as any);
      const info = await fallbackTransporter.sendMail(mailOptions);

      console.log(
        `[EMAIL SUCCESS] Type: ${emailType} | Recipient: ${options.email} | Subject: "${options.subject}" | ID: ${info.messageId} (Delivered via Fallback Transport)`
      );

      // Cache the successful fallback transporter
      transporter = fallbackTransporter;
      return { success: true, messageId: info.messageId };
    } catch (fallbackError: any) {
      const fallbackMsg = fallbackError?.response || fallbackError?.message || primaryMsg;
      console.error(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email} | Error: ${fallbackMsg}`);
      console.error(`   ↳ Primary Failure:   ${primaryMsg} (Code: ${primaryCode || "N/A"})`);
      console.error(`   ↳ Fallback Failure:  ${fallbackError?.message} (Code: ${fallbackError?.code || "N/A"})`);
      console.error(`   ↳ Diagnostic Info:   Target Host=${config.host}:${config.port}, User=${config.user ? config.user.replace(/(.{3}).*(@.*)/, "$1***$2") : "EMPTY"}, Cloud=${config.isCloudPlatform}`);
      
      resetTransporter();
      return { success: false, error: fallbackMsg };
    }
  }
};

export default sendEmail;