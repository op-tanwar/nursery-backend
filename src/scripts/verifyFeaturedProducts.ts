import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import http from "node:http";
import mongoose from "mongoose";
import app from "../app";

async function runFeaturedProductsAudit() {
  console.log("===============================================================");
  console.log("🌿 AUDITING FEATURED & BEST-SELLER PRODUCTS ENDPOINTS");
  console.log("===============================================================\n");

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 4000;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, desc: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`  ✅ PASS [${total}]: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL [${total}]: ${desc} -> ${detail}`);
    }
  }

  try {
    // 1. Featured Plants (Global - No Pincode)
    const res1 = await fetch(`${baseUrl}/api/v1/products/featured?category=plants&limit=8`);
    const json1 = await res1.json();
    console.log("Response 1:", json1);
    assert(
      res1.status === 200 && json1.success === true && Array.isArray(json1.products),
      "GET /api/v1/products/featured?category=plants (Global best-sellers)",
      `Status: ${res1.status}, Count: ${json1.count}`
    );

    // 2. Featured Pots (Global - No Pincode)
    const res2 = await fetch(`${baseUrl}/api/v1/products/featured?category=pots&limit=8`);
    const json2 = await res2.json();
    assert(
      res2.status === 200 && json2.success === true && Array.isArray(json2.products),
      "GET /api/v1/products/featured?category=pots (Global best-sellers)",
      `Status: ${res2.status}, Count: ${json2.count}`
    );

    // 3. Featured Plants with Pincode (Hyperlocal Indore 452001)
    const res3 = await fetch(`${baseUrl}/api/v1/products/featured?category=plants&pincode=452001&limit=8`);
    const json3 = await res3.json();
    assert(
      res3.status === 200 && json3.success === true && json3.isHyperlocal === true && json3.pincode === "452001",
      "GET /api/v1/products/featured?category=plants&pincode=452001 (Hyperlocal ranking)",
      `Status: ${res3.status}, Hyperlocal: ${json3.isHyperlocal}`
    );

    // 4. Featured Pots with Pincode (National Courier category with Pincode)
    const res4 = await fetch(`${baseUrl}/api/v1/products/featured?category=pots&pincode=452001&limit=8`);
    const json4 = await res4.json();
    assert(
      res4.status === 200 && json4.success === true && json4.isHyperlocal === true,
      "GET /api/v1/products/featured?category=pots&pincode=452001 (National category ranking)",
      `Status: ${res4.status}, Hyperlocal: ${json4.isHyperlocal}`
    );

    // 5. Backward-compatibility alias: /plants/allPlants
    const res5 = await fetch(`${baseUrl}/api/v1/plants/allPlants?limit=4`);
    const json5 = await res5.json();
    assert(
      res5.status === 200 && json5.success === true && Array.isArray(json5.plants || json5.products),
      "GET /api/v1/plants/allPlants (Backward compatibility alias)",
      `Status: ${res5.status}`
    );

    // 6. Backward-compatibility alias: /pots/allPots
    const res6 = await fetch(`${baseUrl}/api/v1/pots/allPots?limit=4`);
    const json6 = await res6.json();
    assert(
      res6.status === 200 && json6.success === true && Array.isArray(json6.pots || json6.products),
      "GET /api/v1/pots/allPots (Backward compatibility alias)",
      `Status: ${res6.status}`
    );
  } finally {
    server.close();
  }

  console.log("\n===============================================================");
  console.log(`📊 FEATURED PRODUCTS AUDIT: ${passed}/${total} CHECKS PASSED`);
  console.log("===============================================================");

  if (passed === total) {
    console.log("🎉 ALL FEATURED PRODUCT ENDPOINT CHECKS PASSED!");
  } else {
    process.exit(1);
  }
}

runFeaturedProductsAudit().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
