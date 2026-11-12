import nodemailer, { Transporter } from "nodemailer";
import { EmailOptions, EmailResult, EmailProviderType } from "../types/email.types";

export { EmailOptions, EmailResult, EmailProviderType };

let smtpTransporter: Transporter | null = null;

/**
 * Normalizes email configuration across HTTPS REST APIs (Brevo / Resend)
 * and legacy SMTP conventions (Render, Docker, Heroku, AWS, local dev).
 */
export const getEmailConfig = () => {
  // 1. HTTPS REST API Keys (Priority 1 — Never blocked by Cloud Container Firewalls)
  const brevoApiKey = (
    process.env.BREVO_API_KEY ||
    process.env.SENDINBLUE_API_KEY ||
    ""
  ).trim().replace(/^["']|["']$/g, "");

  const resendApiKey = (
    process.env.RESEND_API_KEY ||
    ""
  ).trim().replace(/^["']|["']$/g, "");

  // Provider-specific sender email overrides (e.g. verified senders in Brevo/Resend)
  const brevoSenderEmail = (
    process.env.BREVO_SENDER_EMAIL ||
    process.env.BREVO_FROM_EMAIL ||
    ""
  ).trim().replace(/^["']|["']$/g, "");

  const resendFromEmail = (
    process.env.RESEND_FROM_EMAIL ||
    process.env.RESEND_SENDER_EMAIL ||
    ""
  ).trim().replace(/^["']|["']$/g, "");

  // 2. Fallback SMTP Configuration (Priority 2)
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

  // Strip any accidental whitespace, carriage returns, or wrapping quotes from credentials
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

  const rawPort = process.env.SMTP_PORT || process.env.EMAIL_PORT || process.env.MAIL_PORT;
  let port: number;
  if (rawPort && !isNaN(Number(rawPort))) {
    port = Number(rawPort);
  } else if (isGmail || isCloudPlatform) {
    port = 465;
  } else {
    port = 587;
  }

  const explicitSecure = process.env.SMTP_SECURE || process.env.EMAIL_SECURE;
  const secure =
    explicitSecure !== undefined
      ? explicitSecure === "true"
      : port === 465;

  const defaultFromEmail = (
    process.env.SMTP_FROM_EMAIL ||
    process.env.FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    process.env.SMTP_FROM ||
    user ||
    "support@urbannursery.in"
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
    "admin@urbannursery.in"
  ).trim().replace(/^["']|["']$/g, "");

  // Determine active provider based on precedence
  let activeProvider: EmailProviderType = "GMAIL_SMTP";
  let fromEmail = defaultFromEmail;

  if (brevoApiKey) {
    activeProvider = "BREVO_API";
    fromEmail = brevoSenderEmail || defaultFromEmail;
  } else if (resendApiKey) {
    activeProvider = "RESEND_API";
    fromEmail = resendFromEmail || defaultFromEmail;
  } else {
    activeProvider = "GMAIL_SMTP";
    fromEmail = defaultFromEmail;
  }

  const isConfigured = Boolean(
    brevoApiKey ||
    resendApiKey ||
    (user && pass)
  );

  return {
    brevoApiKey,
    resendApiKey,
    brevoSenderEmail,
    resendFromEmail,
    hasHttpApi: Boolean(brevoApiKey || resendApiKey),
    activeProvider,
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
    isConfigured,
  };
};

/**
 * Builds resilient SMTP transport options with strict timeouts (8000ms / 8000ms / 10000ms)
 * to prevent cloud containers on Render from hanging on blocked outbound ports.
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
    secure: is465,
    requireTLS: is587,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    tls: {
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
    },
    pool: false, // Pooling disabled on cloud containers
    connectionTimeout: 8000, // Strict timeout: never hang for 60s
    greetingTimeout: 8000,
    socketTimeout: 10000,
  };
};

/**
 * Initializes or retrieves the singleton Nodemailer transporter (SMTP Fallback)
 */
export const getTransporter = (): Transporter => {
  const config = getEmailConfig();

  if (!config.user || !config.pass) {
    console.warn("⚠️ [Nodemailer] SMTP credentials (SMTP_USER/SMTP_PASS) are not configured.");
  }

  if (!smtpTransporter) {
    try {
      const options = buildTransportOptions(config);
      smtpTransporter = nodemailer.createTransport(options as any);
    } catch (error: any) {
      console.error("❌ [Nodemailer] Transporter creation failed:", error?.message || error);
      throw error;
    }
  }

  return smtpTransporter;
};

/**
 * Reset transporter cache
 */
export const resetTransporter = (): void => {
  smtpTransporter = null;
};

/**
 * Helper to extract standardized error diagnostics
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

const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// ======================================================================
// 🚀 PROVIDER 1A: BREVO HTTPS REST API (Port 443 — Zero Port Blocking)
// ======================================================================
async function sendViaBrevoApi(
  options: EmailOptions,
  config: ReturnType<typeof getEmailConfig>
): Promise<EmailResult> {
  const emailType = options.type || "TRANSACTIONAL";
  const url = "https://api.brevo.com/v3/smtp/email";

  const payload: any = {
    sender: {
      name: config.fromName,
      email: config.fromEmail,
    },
    to: [
      {
        email: options.email,
        name: options.name || options.email.split("@")[0],
      },
    ],
    subject: options.subject,
    htmlContent: options.html || options.message,
    textContent: options.message,
  };

  if (options.replyTo) {
    payload.replyTo = { email: options.replyTo };
  }

  if (options.cc) {
    const ccList = Array.isArray(options.cc) ? options.cc : [options.cc];
    payload.cc = ccList.map((c) => ({ email: c }));
  }

  if (options.bcc) {
    const bccList = Array.isArray(options.bcc) ? options.bcc : [options.bcc];
    payload.bcc = bccList.map((b) => ({ email: b }));
  }

  if (options.attachments && options.attachments.length > 0) {
    payload.attachment = options.attachments.map((att) => ({
      name: att.filename,
      content: Buffer.isBuffer(att.content)
        ? att.content.toString("base64")
        : typeof att.content === "string"
        ? Buffer.from(att.content).toString("base64")
        : att.content,
    }));
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": config.brevoApiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000), // 10s request timeout
    });

    const responseText = await response.text();
    let responseData: any = {};
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { message: responseText };
    }

    if (response.ok) {
      const messageId = responseData.messageId || `brevo-${Date.now()}`;
      console.log(
        `[EMAIL SUCCESS] Provider: BREVO_API (HTTPS Port 443) | Type: ${emailType} | Recipient: ${options.email} | Subject: "${options.subject}" | ID: ${messageId}`
      );
      return {
        success: true,
        providerUsed: "BREVO_API",
        messageId,
        errorDetails: null,
      };
    } else {
      const errMsg =
        responseData?.message ||
        responseData?.error ||
        `Brevo API HTTP ${response.status}: ${response.statusText}`;
      const errCode = responseData?.code || String(response.status);

      console.error(
        `❌ [EMAIL ERROR] Provider: BREVO_API | Status: ${response.status} | Recipient: ${options.email} | Error: ${errMsg}`
      );

      return {
        success: false,
        providerUsed: "BREVO_API",
        messageId: null,
        error: errMsg,
        code: errCode,
        response: responseText,
        responseCode: response.status,
        errorDetails: {
          code: errCode,
          message: errMsg,
          providerResponse: responseData,
        },
      };
    }
  } catch (err: any) {
    const errMsg = err?.message || "Brevo network dispatch failure";
    console.error(`❌ [EMAIL ERROR] Provider: BREVO_API Fetch Exception: ${errMsg}`);
    return {
      success: false,
      providerUsed: "BREVO_API",
      messageId: null,
      error: errMsg,
      code: err?.name || "ENETWORK",
      errorDetails: {
        code: err?.name || "ENETWORK",
        message: errMsg,
        providerResponse: err?.cause || null,
      },
    };
  }
}

// ======================================================================
// 🚀 PROVIDER 1B: RESEND HTTPS REST API (Port 443 — Zero Port Blocking)
// ======================================================================
async function sendViaResendApi(
  options: EmailOptions,
  config: ReturnType<typeof getEmailConfig>
): Promise<EmailResult> {
  const emailType = options.type || "TRANSACTIONAL";
  const url = "https://api.resend.com/emails";

  const payload: any = {
    from: `${config.fromName} <${config.fromEmail}>`,
    to: [options.email],
    subject: options.subject,
    html: options.html || options.message,
    text: options.message,
  };

  if (options.replyTo) {
    payload.reply_to = options.replyTo;
  }

  if (options.cc) {
    payload.cc = Array.isArray(options.cc) ? options.cc : [options.cc];
  }

  if (options.bcc) {
    payload.bcc = Array.isArray(options.bcc) ? options.bcc : [options.bcc];
  }

  if (options.attachments && options.attachments.length > 0) {
    payload.attachments = options.attachments.map((att) => ({
      filename: att.filename,
      content: Buffer.isBuffer(att.content)
        ? att.content.toString("base64")
        : att.content,
    }));
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    const responseText = await response.text();
    let responseData: any = {};
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { message: responseText };
    }

    if (response.ok) {
      const messageId = responseData.id || `resend-${Date.now()}`;
      console.log(
        `[EMAIL SUCCESS] Provider: RESEND_API (HTTPS Port 443) | Type: ${emailType} | Recipient: ${options.email} | Subject: "${options.subject}" | ID: ${messageId}`
      );
      return {
        success: true,
        providerUsed: "RESEND_API",
        messageId,
        errorDetails: null,
      };
    } else {
      const errMsg =
        responseData?.message ||
        `Resend API HTTP ${response.status}: ${response.statusText}`;
      const errCode = responseData?.name || String(response.status);

      console.error(
        `❌ [EMAIL ERROR] Provider: RESEND_API | Status: ${response.status} | Recipient: ${options.email} | Error: ${errMsg}`
      );

      return {
        success: false,
        providerUsed: "RESEND_API",
        messageId: null,
        error: errMsg,
        code: errCode,
        response: responseText,
        responseCode: response.status,
        errorDetails: {
          code: errCode,
          message: errMsg,
          providerResponse: responseData,
        },
      };
    }
  } catch (err: any) {
    const errMsg = err?.message || "Resend network dispatch failure";
    console.error(`❌ [EMAIL ERROR] Provider: RESEND_API Fetch Exception: ${errMsg}`);
    return {
      success: false,
      providerUsed: "RESEND_API",
      messageId: null,
      error: errMsg,
      code: err?.name || "ENETWORK",
      errorDetails: {
        code: err?.name || "ENETWORK",
        message: errMsg,
        providerResponse: err?.cause || null,
      },
    };
  }
}

// ======================================================================
// 🔄 PROVIDER 2: NODEMAILER SMTP FALLBACK (With Aggressive Timeouts)
// ======================================================================
async function sendViaNodemailerSmtp(
  options: EmailOptions,
  config: ReturnType<typeof getEmailConfig>
): Promise<EmailResult> {
  const emailType = options.type || "TRANSACTIONAL";

  if (!config.user || !config.pass) {
    const warn = `Email not sent to ${options.email}: SMTP credentials missing in environment variables. Set BREVO_API_KEY, RESEND_API_KEY, or SMTP_USER & SMTP_PASS. (Subject: "${options.subject}")`;
    console.warn(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email} | Error: ${warn}`);
    return {
      success: false,
      providerUsed: "GMAIL_SMTP",
      error: warn,
      code: "ECONFIG",
      errorDetails: {
        code: "ECONFIG",
        message: "No email credentials configured. Please set BREVO_API_KEY or SMTP_USER/SMTP_PASS in Render.",
        providerResponse: null,
      },
    };
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

  // Stage 1: Primary SMTP Port (465 or configured port)
  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail(mailOptions);
    console.log(
      `[EMAIL SUCCESS] Provider: GMAIL_SMTP (Port ${config.port}) | Type: ${emailType} | Recipient: ${options.email} | Subject: "${options.subject}" | ID: ${info.messageId}`
    );
    return {
      success: true,
      providerUsed: "GMAIL_SMTP",
      messageId: info.messageId,
      errorDetails: null,
    };
  } catch (primaryError: any) {
    const primaryMsg = primaryError?.message || primaryError?.response || "Unknown primary SMTP error";
    const primaryCode = primaryError?.code;

    // Fast-fail if authentication was rejected
    if (primaryCode === "EAUTH" || primaryError?.responseCode === 535) {
      resetTransporter();
      const authErr =
        "SMTP Authentication Failed (535). Please verify your SMTP_USER and 16-character Google App Password in Render Dashboard.";
      console.error(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email} | Error: ${authErr}`);
      return {
        success: false,
        providerUsed: "GMAIL_SMTP",
        error: authErr,
        code: primaryCode,
        response: primaryError?.response,
        responseCode: primaryError?.responseCode,
        command: primaryError?.command,
        errorDetails: {
          code: primaryCode,
          message: authErr,
          providerResponse: primaryError?.response || null,
        },
      };
    }

    // Stage 2: Dual-Port Auto-Recovery Fallback (465 <-> 587)
    const fallbackPort = config.port === 465 ? 587 : 465;
    console.warn(
      `⚠️ [Nodemailer] Primary SMTP failed for ${options.email} (Port ${config.port}: ${primaryMsg}). Falling back to Port ${fallbackPort}...`
    );

    try {
      resetTransporter();
      const fallbackOptions = buildTransportOptions(config, fallbackPort);
      const fallbackTransporter = nodemailer.createTransport(fallbackOptions as any);
      const info = await fallbackTransporter.sendMail(mailOptions);

      console.log(
        `[EMAIL SUCCESS] Provider: GMAIL_SMTP (Fallback Port ${fallbackPort}) | Type: ${emailType} | Recipient: ${options.email} | Subject: "${options.subject}" | ID: ${info.messageId}`
      );

      smtpTransporter = fallbackTransporter;
      return {
        success: true,
        providerUsed: "GMAIL_SMTP",
        messageId: info.messageId,
        errorDetails: null,
      };
    } catch (fallbackError: any) {
      const fallbackMsg = fallbackError?.response || fallbackError?.message || primaryMsg;
      console.error(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email} | Error: ${fallbackMsg}`);
      console.error(
        `   ↳ Render Port Blocking Alert: Cloud containers frequently drop SMTP ports 465/587. Configure BREVO_API_KEY in Render for 100% reliable HTTPS Port 443 delivery.`
      );

      resetTransporter();
      return {
        success: false,
        providerUsed: "GMAIL_SMTP",
        error: fallbackMsg,
        code: fallbackError?.code || primaryCode || "ESMTP",
        response: fallbackError?.response || primaryError?.response,
        responseCode: fallbackError?.responseCode || primaryError?.responseCode,
        command: fallbackError?.command || primaryError?.command,
        errorDetails: {
          code: fallbackError?.code || primaryCode || "ESMTP",
          message: fallbackMsg,
          providerResponse: fallbackError?.response || primaryError?.response || null,
        },
      };
    }
  }
}

/**
 * Core sendEmail utility implementing the Dual-Provider HTTPS Email Engine.
 *
 * Precedence:
 * 1. BREVO_API (HTTPS Port 443 — Native Fetch, Zero Port Blocking)
 * 2. RESEND_API (HTTPS Port 443 — Native Fetch, Zero Port Blocking)
 * 3. GMAIL_SMTP / NODEMAILER (Fallback with strict 8s/8s/10s timeouts)
 */
export const sendEmail = async (options: EmailOptions): Promise<EmailResult> => {
  const config = getEmailConfig();
  const emailType = options.type || "TRANSACTIONAL";

  if (!options.email || !isValidEmail(options.email)) {
    const err = `Invalid or missing recipient email: "${options.email}"`;
    console.error(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email || "undefined"} | Error: ${err}`);
    return {
      success: false,
      providerUsed: config.activeProvider,
      error: err,
      code: "EINVALIDEMAIL",
      errorDetails: {
        code: "EINVALIDEMAIL",
        message: err,
        providerResponse: null,
      },
    };
  }

  if (!options.subject) {
    const err = "Email subject is required";
    console.error(`[EMAIL ERROR] Type: ${emailType} | Recipient: ${options.email} | Error: ${err}`);
    return {
      success: false,
      providerUsed: config.activeProvider,
      error: err,
      code: "ENOSUBJECT",
      errorDetails: {
        code: "ENOSUBJECT",
        message: err,
        providerResponse: null,
      },
    };
  }

  // Dispatch based on prioritized provider pipeline
  if (config.brevoApiKey) {
    const result = await sendViaBrevoApi(options, config);
    // If Brevo succeeded, return immediately
    if (result.success) return result;

    // If Brevo failed, check if Resend is available as secondary HTTP API
    if (config.resendApiKey) {
      console.warn("⚠️ [Email Engine] Brevo API failed. Attempting secondary HTTPS provider: Resend...");
      const resendResult = await sendViaResendApi(options, config);
      if (resendResult.success) return resendResult;
    }

    return result;
  }

  if (config.resendApiKey) {
    return await sendViaResendApi(options, config);
  }

  // Fallback to Nodemailer SMTP
  return await sendViaNodemailerSmtp(options, config);
};

/**
 * Startup connection verification probe.
 * Supports verifying Brevo API, Resend API, or Nodemailer SMTP.
 */
export const verifyEmailConnection = async (): Promise<boolean> => {
  const config = getEmailConfig();

  console.log("\n=======================================================");
  console.log("📧 [Email Engine] Verifying Urban Nursery Email Pipeline...");
  console.log(`   Active Provider: ${config.activeProvider}`);
  console.log(`   Transport Type:  ${config.hasHttpApi ? "HTTPS REST API (Port 443 — Zero Port Blocking)" : "SMTP TCP (Subject to Cloud Port Filtering)"}`);
  console.log(`   Sender:          "${config.fromName}" <${config.fromEmail}>`);
  console.log(`   Admin Alert:     ${config.adminEmail}`);
  console.log(`   Platform:        ${config.isCloudPlatform ? "Cloud Container (Render/AWS)" : "Standard"}`);

  if (!config.isConfigured) {
    console.warn("⚠️ [Email Engine] WARNING: No email provider configured.");
    console.warn("   Recommended for Render: Add BREVO_API_KEY in Render Dashboard for instant 443 HTTPS delivery.");
    console.warn("   Alternatively: Add RESEND_API_KEY or SMTP_USER & SMTP_PASS.");
    console.log("=======================================================\n");
    return false;
  }

  // 1. Probe Brevo API
  if (config.brevoApiKey) {
    try {
      const res = await fetch("https://api.brevo.com/v3/account", {
        headers: {
          accept: "application/json",
          "api-key": config.brevoApiKey,
        },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const data: any = await res.json().catch(() => ({}));
        console.log(`✅ [Brevo API] Connected and verified via HTTPS Port 443! Account: ${data.email || "Active"}`);
        console.log("=======================================================\n");
        return true;
      } else {
        const errText = await res.text();
        console.error(`❌ [Brevo API] Verification failed with HTTP ${res.status}: ${errText}`);
        console.log("=======================================================\n");
        return false;
      }
    } catch (e: any) {
      console.error(`❌ [Brevo API] Verification network failure: ${e?.message || e}`);
      console.log("=======================================================\n");
      return false;
    }
  }

  // 2. Probe Resend API
  if (config.resendApiKey) {
    try {
      const res = await fetch("https://api.resend.com/api-keys", {
        headers: {
          Authorization: `Bearer ${config.resendApiKey}`,
        },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        console.log("✅ [Resend API] Connected and verified via HTTPS Port 443!");
        console.log("=======================================================\n");
        return true;
      } else {
        const errText = await res.text();
        console.error(`❌ [Resend API] Verification failed with HTTP ${res.status}: ${errText}`);
        console.log("=======================================================\n");
        return false;
      }
    } catch (e: any) {
      console.error(`❌ [Resend API] Verification network failure: ${e?.message || e}`);
      console.log("=======================================================\n");
      return false;
    }
  }

  // 3. Probe SMTP Transporter
  try {
    const t = getTransporter();
    await t.verify();
    console.log(`✅ [Nodemailer SMTP] Connected to ${config.host}:${config.port}`);
    console.log("=======================================================\n");
    return true;
  } catch (error: any) {
    console.error("❌ CRITICAL: Nodemailer SMTP Verification failed:", error?.message || error);
    console.error(`   ↳ Code: ${error?.code || "N/A"} | ResponseCode: ${error?.responseCode || "N/A"}`);

    if (error.code === "EAUTH" || error.responseCode === 535) {
      console.error("   ↳ Reason: Invalid username or password (requires 16-character Google App Password).");
      console.log("=======================================================\n");
      resetTransporter();
      return false;
    }

    // Probe fallback port 587 / 465
    const fallbackPort = config.port === 465 ? 587 : 465;
    try {
      console.log(`   ↳ Probing fallback SMTP Port ${fallbackPort}...`);
      const fallbackOptions = buildTransportOptions(config, fallbackPort);
      const fallbackTransporter = nodemailer.createTransport(fallbackOptions as any);
      await fallbackTransporter.verify();

      console.log(`✅ [Nodemailer SMTP] Fallback Port ${fallbackPort} connected!`);
      console.log("=======================================================\n");
      smtpTransporter = fallbackTransporter;
      return true;
    } catch (fallbackError: any) {
      console.error(
        `❌ SMTP Transport verification failed on both primary (${config.port}) and fallback (${fallbackPort}):`,
        fallbackError?.message || fallbackError
      );
      console.warn("   ↳ Action required for Render: Switch to HTTPS REST API by setting BREVO_API_KEY in Render Dashboard.");
      console.log("=======================================================\n");
      resetTransporter();
      return false;
    }
  }
};

export default sendEmail;
