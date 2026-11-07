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

import sendEmail, { getEmailConfig, verifyEmailConnection, getTransporter, formatEmailError } from "../utils/sendEmail";
import emailService from "../services/emailService";

async function runEmailSmokeTest() {
  console.log("\n=======================================================");
  console.log("🧪 Urban Nursery / Planto — SMTP Email Pipeline Test");
  console.log("=======================================================\n");

  const config = getEmailConfig();
  console.log("Configuration Summary:");
  console.log(`  Host:        ${config.host}`);
  console.log(`  Port:        ${config.port}`);
  console.log(`  Secure:      ${config.secure}`);
  console.log(`  User:        ${config.user}`);
  console.log(`  Pass Length: ${config.pass ? config.pass.length : 0} chars`);
  console.log(`  Sender:      "${config.fromName}" <${config.fromEmail}>`);
  console.log(`  Admin Email: ${config.adminEmail}`);
  console.log(`  Platform:    ${config.isCloudPlatform ? "Cloud Container (Render/AWS)" : "Standard"}`);
  console.log("-------------------------------------------------------");

  // Step 1: Verify Connection
  console.log("\n[Step 1/3] Verifying SMTP Transporter Connection...");
  const isConnected = await verifyEmailConnection();
  if (!isConnected) {
    console.error("❌ SMTP Verification failed. Aborting dispatch test.");
    process.exit(1);
  }

  // Step 2: Verify Centralized Service Helpers
  console.log("\n[Step 2/3] Verifying Email Service Helper Functions...");
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
    "sendNurseryPayoutNotification",
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
    console.error("❌ No target recipient email provided or configured.");
    process.exit(1);
  }

  console.log(`\n[Step 3/3] Sending Diagnostic Test Email to: ${targetEmail}...`);
  const timestamp = new Date().toISOString();
  const testSubject = `🧪 [SMTP Test] Urban Nursery Pipeline Check (${timestamp})`;
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
          <td style="padding: 8px 0; font-weight: bold;">Host / Port:</td>
          <td style="padding: 8px 0;">${config.host}:${config.port} (Secure: ${config.secure})</td>
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
    message: `Urban Nursery SMTP Diagnostic Test completed successfully at ${timestamp}. Host: ${config.host}:${config.port}`,
    html: testHtml,
    type: "DIAGNOSTIC_TEST",
  });

  if (result.success) {
    console.log("\n=======================================================");
    console.log("🎉 SUCCESS: Test email delivered!");
    console.log(`   Message ID: ${result.messageId}`);
    console.log(`   Recipient:  ${targetEmail}`);
    console.log(`   Envelope:   from=${config.fromEmail}, to=${targetEmail}`);
    console.log("=======================================================\n");
    process.exit(0);
  } else {
    console.error("\n=======================================================");
    console.error("❌ FAILURE: Test email dispatch failed.");
    console.error(`   Error: ${result.error}`);
    console.error("=======================================================\n");
    process.exit(1);
  }
}

runEmailSmokeTest().catch((err) => {
  console.error("❌ Unexpected test runner error:", err);
  process.exit(1);
});
