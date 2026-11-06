import path from "node:path";
import dotenv from "dotenv";

// Load environment variables before importing app
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import http from "node:http";
import mongoose from "mongoose";
import app from "../app";
import { calculateAuthoritativeTotals, toPaise, toRupees } from "../utils/pricingUtils";

async function runLiveSmokeTests() {
  console.log("==================================================================");
  console.log("🚀 EXECUTING END-TO-END PRODUCTION SMOKE VERIFICATION SUITE");
  console.log("==================================================================");

  // Connect MongoDB Atlas if DB_URI is present
  if (process.env.DB_URI) {
    try {
      console.log("Connecting to MongoDB Atlas...");
      await mongoose.connect(process.env.DB_URI, { serverSelectionTimeoutMS: 5000 });
      console.log("✅ MongoDB Connected successfully.");
    } catch (err: any) {
      console.warn("⚠️ MongoDB Atlas connection skipped or offline:", err.message);
    }
  }

  // 1. Boot local ephemeral server on random free port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 4000;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`📡 Ephemeral Test Server listening on: ${baseUrl}`);

  let passedCount = 0;
  let totalCount = 0;

  function assert(condition: boolean, desc: string, detail?: string) {
    totalCount++;
    if (condition) {
      console.log(`  ✅ PASS [${totalCount}]: ${desc}`);
      passedCount++;
    } else {
      console.error(`  ❌ FAIL [${totalCount}]: ${desc} -> Detail: ${detail}`);
    }
  }

  try {
    // ------------------------------------------------------------------
    // TEST 1: Root & Health Check Endpoints
    // ------------------------------------------------------------------
    console.log("\n--- Phase 1: System Health Probes ---");
    const rootRes = await fetch(`${baseUrl}/`);
    const rootJson = await rootRes.json();
    assert(
      rootRes.status === 200 && rootJson.success === true,
      "Root endpoint (GET /) responds with 200 OK and valid health payload",
      JSON.stringify(rootJson)
    );

    const healthRes = await fetch(`${baseUrl}/health`);
    const healthJson = await healthRes.json();
    assert(
      [200, 503].includes(healthRes.status) && typeof healthJson.status === "string",
      "System health endpoint (GET /health) responds with standardized status",
      `Status: ${healthRes.status}, Body: ${JSON.stringify(healthJson)}`
    );

    // ------------------------------------------------------------------
    // TEST 2: Cart Routes Availability
    // ------------------------------------------------------------------
    console.log("\n--- Phase 2: Cart & Wishlist Routes Mounting ---");
    const cartRes = await fetch(`${baseUrl}/api/v1/shop/cart`);
    // Expected 200 for guest cart (if session supported) or 401 if auth required, NEVER 404
    assert(
      cartRes.status !== 404,
      "E-commerce Cart Gateway (GET /api/v1/shop/cart) is correctly mounted (Status !== 404)",
      `Received HTTP status: ${cartRes.status}`
    );

    // ------------------------------------------------------------------
    // TEST 3: Coupon Promotion & Validation Engine
    // ------------------------------------------------------------------
    console.log("\n--- Phase 3: Coupon & Promotional Engine ---");
    const couponValidateRes = await fetch(`${baseUrl}/api/v1/promotions/coupon/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "WELCOME50", cartTotal: 500 }),
    });
    // Expected: 200, 400 (validation error/invalid code), or 401; NEVER 404!
    assert(
      couponValidateRes.status !== 404,
      "Coupon Validation Endpoint (POST /api/v1/promotions/coupon/validate) is mounted (Status !== 404)",
      `Received HTTP status: ${couponValidateRes.status}`
    );

    // ------------------------------------------------------------------
    // TEST 4: Admin Dashboard & Protected Analytics
    // ------------------------------------------------------------------
    console.log("\n--- Phase 4: Administrative Security Boundaries ---");
    const adminStatsRes = await fetch(`${baseUrl}/api/v1/admin-dashboard/stats`);
    // Must be rejected with 401 Unauthorized for unauthenticated requests
    assert(
      adminStatsRes.status === 401,
      "Admin Dashboard Stats (GET /api/v1/admin-dashboard/stats) rejects unauthenticated access with 401 Unauthorized",
      `Received HTTP status: ${adminStatsRes.status}`
    );

    const adminReviewsRes = await fetch(`${baseUrl}/api/v1/admin/reviews`);
    assert(
      adminReviewsRes.status === 401,
      "Global Reviews Moderation Queue (GET /api/v1/admin/reviews) enforces 401 Unauthorized guard",
      `Received HTTP status: ${adminReviewsRes.status}`
    );

    // ------------------------------------------------------------------
    // TEST 5: Razorpay Webhook Signature Rejection
    // ------------------------------------------------------------------
    console.log("\n--- Phase 5: Payment Webhook Security ---");
    const webhookRes = await fetch(`${baseUrl}/api/v1/payment/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-signature": "forged_unauthorized_signature_payload",
      },
      body: JSON.stringify({ event: "payment.captured", payload: {} }),
    });
    // Forged signature must be rejected with 400 Bad Request
    assert(
      webhookRes.status === 400,
      "Razorpay Webhook (POST /api/v1/payment/webhook) strictly rejects invalid cryptographic signatures with 400 Bad Request",
      `Received HTTP status: ${webhookRes.status}`
    );

    // ------------------------------------------------------------------
    // TEST 6: Financial Calculations & Paise Accuracy
    // ------------------------------------------------------------------
    console.log("\n--- Phase 6: Financial Calculations & Paise Accuracy ---");
    const mockOrderItems = [
      {
        price: 299,
        quantity: 2,
        category: "plants",
      },
      {
        price: 499,
        discountPrice: 399,
        quantity: 1,
        category: "pots",
      },
    ];

    const authoritativeTotals = calculateAuthoritativeTotals(mockOrderItems as any);
    // 299 * 2 = 598. Effective price for pot: 399 * 1 = 399. Items price = 598 + 399 = 997.
    // Shipping: >= 500 is free (0).
    // Exclusive GST: 5% on 598 (29.90) + 18% on 399 (71.82) = 101.72. Total = 997 + 101.72 = 1098.72.
    assert(
      authoritativeTotals.itemsPrice === 997 &&
        authoritativeTotals.shippingPrice === 0 &&
        authoritativeTotals.taxPrice === 101.72 &&
        authoritativeTotals.totalPrice === 1098.72,
      "Authoritative Pricing Engine correctly calculates multi-item order with free delivery threshold and GST (₹1098.72)",
      JSON.stringify(authoritativeTotals)
    );

    // Mathematical integer precision check (no floating point drift)
    const paiseCheck = toRupees(toPaise(0.1) + toPaise(0.2));
    assert(
      paiseCheck === 0.3,
      "Integer Paise Conversion completely prevents floating point drift (0.1 + 0.2 = 0.3)",
      `Result: ${paiseCheck}`
    );

    // ------------------------------------------------------------------
    // TEST 7: Catalog Route PDP Resolution
    // ------------------------------------------------------------------
    console.log("\n--- Phase 7: Product Catalog PDP Routing ---");
    const catalogRes = await fetch(`${baseUrl}/api/v1/products?limit=1`);
    assert(
      catalogRes.status !== 404,
      "Product Catalog Query (GET /api/v1/products) route is correctly mounted without 404 mismatch",
      `Received HTTP status: ${catalogRes.status}`
    );
  } finally {
    server.close();
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }

  console.log("\n==================================================================");
  console.log(`📊 SMOKE VERIFICATION COMPLETE: ${passedCount}/${totalCount} CHECKS PASSED`);
  console.log("==================================================================");

  if (passedCount === totalCount) {
    console.log("🎉 ALL LIVE SMOKE PROBES SUCCEEDED WITH ZERO REGRESSIONS!");
    process.exit(0);
  } else {
    console.error("❌ CRITICAL ISSUES DETECTED DURING SMOKE TESTS!");
    process.exit(1);
  }
}

runLiveSmokeTests().catch((err) => {
  console.error("Fatal exception during smoke tests:", err);
  process.exit(1);
});
