import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

// Load environment variables
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

import sendEmail, { getEmailConfig, verifyEmailConnection, formatEmailError } from "../utils/sendEmail";
import * as emailService from "../services/emailService";

async function runEmailSmokeTest() {
  console.log("\n=======================================================");
  console.log("🧪 Urban Nursery / Planto — Dual-Provider Email Engine Test");
  console.log("=======================================================\n");

  const config = getEmailConfig();
  console.log("Configuration Summary:");
  console.log(`  Active Provider: ${config.activeProvider}`);
  console.log(`  Protocol:        ${config.hasHttpApi ? "HTTPS REST API (Port 443 — Zero Cloud Port Blocking)" : `SMTP TCP (Port ${config.port})`}`);
  console.log(`  Brevo Config:    ${config.brevoApiKey ? "Configured (API Key Present)" : "Not Configured"}`);
  console.log(`  Resend Config:   ${config.resendApiKey ? "Configured (API Key Present)" : "Not Configured"}`);
  console.log(`  SMTP Config:     ${config.user ? `Configured (${config.user})` : "Not Configured"}`);
  console.log(`  Sender Identity: "${config.fromName}" <${config.fromEmail}>`);
  console.log(`  Admin Alert:     ${config.adminEmail}`);
  console.log(`  Platform:        ${config.isCloudPlatform ? "Cloud Container (Render/AWS)" : "Standard"}`);
  console.log("-------------------------------------------------------");

  // Step 1: Verify Connection
  console.log("\n[Step 1/4] Verifying Email Engine Connection / Credentials...");
  const isConnected = await verifyEmailConnection();
  if (!isConnected) {
    console.error("❌ Email Engine verification failed. Aborting dispatch test.");
    process.exit(1);
  }

  // Step 2: Verify Centralized Service Helpers
  console.log("\n[Step 2/4] Auditing All 12+ Transactional Email Helper Functions...");
  const helpers = [
    "sendWelcomeEmail",
    "sendPasswordResetEmail",
    "sendForgotPasswordEmail",
    "sendPasswordChangedAlert",
    "sendOrderConfirmationEmail",
    "sendOrderStatusUpdateEmail",
    "sendOrderStatusProgressionEmail",
    "sendOrderShippedEmail",
    "sendOrderDeliveredEmail",
    "sendNurseryNewOrderAlert",
    "sendNurseryOrderAlertEmail",
    "sendNurseryPayoutNotification",
    "sendPayoutStatusEmail",
    "sendAdminNewOrderEmail",
    "sendAdminNewVendorAlert",
    "sendAdminCriticalPaymentFailureAlert",
  ];
  for (const h of helpers) {
    if (typeof (emailService as any)[h] !== "function") {
      console.error(`❌ Missing expected helper function in emailService: ${h}`);
      process.exit(1);
    }
  }
  console.log(`✅ All ${helpers.length} core typed email helper functions verified in emailService.`);

  // Step 3: Send Test Transactional Email
  const targetEmail = process.argv[2] || config.adminEmail || config.user;
  if (!targetEmail) {
    console.error("❌ No target recipient email provided or configured. Pass email as argv: npm run test:email your@email.com");
    process.exit(1);
  }

  console.log(`\n[Step 3/4] Dispatching Live Diagnostic Test Email to: ${targetEmail}...`);
  const timestamp = new Date().toISOString();
  const testSubject = `🧪 [Diagnostic] Urban Nursery Pipeline Check (${config.activeProvider} - ${timestamp})`;
  const testHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #15803d; margin: 0; font-size: 24px;">🌿 Urban Nursery</h1>
        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Diagnostic Email Subsystem Verification</p>
      </div>
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <h3 style="color: #166534; margin: 0 0 8px 0; font-size: 16px;">✅ Transporter Verified Successfully</h3>
        <p style="color: #15803d; margin: 0; font-size: 14px;">This email confirms that the automated transactional email engine is functioning properly across development and production environments.</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #334155; margin-bottom: 20px;">
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 8px 0; font-weight: bold;">Provider:</td>
          <td style="padding: 8px 0;">${config.activeProvider}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 8px 0; font-weight: bold;">Protocol / Port:</td>
          <td style="padding: 8px 0;">${config.hasHttpApi ? "HTTPS REST API (Port 443 — Zero Port Blocking)" : `SMTP TCP (Port ${config.port})`}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 8px 0; font-weight: bold;">Sender:</td>
          <td style="padding: 8px 0;">${config.fromName} &lt;${config.fromEmail}&gt;</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 8px 0; font-weight: bold;">Timestamp:</td>
          <td style="padding: 8px 0;">${timestamp}</td>
        </tr>
      </table>
      <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
        Urban Nursery Automated Mailer &bull; Do not reply to this automated test.
      </p>
    </div>
  `;

  const result = await sendEmail({
    email: targetEmail,
    subject: testSubject,
    message: `Urban Nursery Diagnostic Test completed successfully at ${timestamp}. Provider: ${config.activeProvider}`,
    html: testHtml,
    type: "DIAGNOSTIC_TEST",
  });

  if (!result.success) {
    console.error("\n=======================================================");
    console.error("❌ FAILURE: Test email dispatch failed.");
    console.error(`   Provider Used: ${result.providerUsed}`);
    console.error(`   Error: ${result.error}`);
    console.error(`   Details:`, result.errorDetails);
    console.error("=======================================================\n");
    process.exit(1);
  }

  console.log(`✅ Diagnostic email delivered via ${result.providerUsed}! Message ID: ${result.messageId}`);

  // Step 4: Verify Forgot Password Email Flow Specifically
  console.log(`\n[Step 4/4] Verifying sendForgotPasswordEmail to: ${targetEmail}...`);
  const mockResetUrl = `https://urbannursery-neon.vercel.app/password/reset/mock-token-${Date.now()}`;
  const resetResult = await emailService.sendForgotPasswordEmail(targetEmail, "Test User", mockResetUrl);

  if (resetResult.success) {
    console.log("\n=======================================================");
    console.log("🎉 SUCCESS: All tests passed!");
    console.log(`   Provider Used:         ${resetResult.providerUsed || result.providerUsed}`);
    console.log(`   Diagnostic Message ID: ${result.messageId}`);
    console.log(`   Reset Password ID:     ${resetResult.messageId}`);
    console.log(`   Recipient:             ${targetEmail}`);
    console.log(`   Envelope:              from=${config.fromEmail}, to=${targetEmail}`);
    console.log("=======================================================\n");
    process.exit(0);
  } else {
    console.error("\n=======================================================");
    console.error("❌ FAILURE: Forgot password email dispatch failed.");
    console.error("❌ Full Email Error in forgotPassword:", {
      message: resetResult.error,
      code: resetResult.code,
      response: resetResult.response,
      command: resetResult.command,
      errorDetails: resetResult.errorDetails,
    });
    console.error("=======================================================\n");
    process.exit(1);
  }
}

runEmailSmokeTest().catch((err) => {
  console.error("❌ Unexpected test runner error:", err);
  process.exit(1);
});
