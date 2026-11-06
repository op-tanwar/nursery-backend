import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load environment variables from planto-bankend/.env
const envPath = path.resolve(__dirname, "../../.env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

import {
  createRedisInstance,
  initRedis,
  disconnectRedis,
  getRedisClient,
  isRedisReady,
  sanitizeRedisUrl,
  maskRedisUri,
} from "../config/redis";

async function runVerification() {
  console.log("================================================================");
  console.log("🔍 REDIS INFRASTRUCTURE & SANITIZATION VERIFICATION SUITE");
  console.log("================================================================\n");

  let failureCount = 0;

  // --------------------------------------------------------------------------
  // Check 1: .env File Syntax Test
  // --------------------------------------------------------------------------
  console.log("📋 [Check 1] Inspecting .env file for strict REDIS_URL syntax...");
  if (!fs.existsSync(envPath)) {
    console.error("❌ Failed to locate .env file at:", envPath);
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, "utf-8");
  const lines = envContent.split(/\r?\n/);
  const redisUrlLine = lines.find((l) => l.trim().startsWith("REDIS_URL="));

  if (!redisUrlLine) {
    console.error("❌ REDIS_URL not defined in .env file");
    failureCount++;
  } else {
    // Assert line strictly matches: ^REDIS_URL=(["'])?rediss?:\/\/[^\s"']+\1$
    const strictRegex = /^REDIS_URL=(["'])?rediss?:\/\/[^\s"']+\1$/;
    const isStrict = strictRegex.test(redisUrlLine.trim());

    if (isStrict) {
      console.log("  ✅ Strict regex syntax check passed:");
      const rawValue = redisUrlLine.trim().split("REDIS_URL=")[1];
      console.log("     Value (Masked):", maskRedisUri(rawValue));
    } else {
      console.error("  ❌ Strict regex syntax check failed for line:");
      console.error("     ", maskRedisUri(redisUrlLine.trim()));
      failureCount++;
    }
  }

  // --------------------------------------------------------------------------
  // Check 2: Defensive URI Sanitizer Unit Test (Handling CLI copy-paste)
  // --------------------------------------------------------------------------
  console.log("\n🛡️ [Check 2] Testing defensive sanitizer against malformed CLI inputs...");
  const testCases = [
    {
      name: "Raw Upstash CLI Command with --tls and -u",
      input: " redis-cli --tls -u redis://default:mockPassword123@mock-cluster.upstash.io:6379",
      expectedProtocol: "rediss:",
      expectedTls: true,
    },
    {
      name: "Quoted Standard Rediss URI",
      input: '"rediss://default:mockPassword123@mock-cluster.upstash.io:6379"',
      expectedProtocol: "rediss:",
      expectedTls: true,
    },
    {
      name: "Local Development Redis URI",
      input: "redis://127.0.0.1:6379",
      expectedProtocol: "redis:",
      expectedTls: false,
    },
  ];

  for (const tc of testCases) {
    const sanitized = sanitizeRedisUrl(tc.input);
    if (!sanitized) {
      console.error(`  ❌ Failed to parse test case: "${tc.name}"`);
      failureCount++;
      continue;
    }

    const parsed = new URL(sanitized.url);
    const passProto = parsed.protocol === tc.expectedProtocol;
    const passTls = sanitized.isTls === tc.expectedTls;

    if (passProto && passTls) {
      console.log(`  ✅ "${tc.name}" -> ${sanitized.maskedUrl} (TLS: ${sanitized.isTls})`);
    } else {
      console.error(`  ❌ Assertion failed for "${tc.name}": protocol=${parsed.protocol}, isTls=${sanitized.isTls}`);
      failureCount++;
    }
  }

  // --------------------------------------------------------------------------
  // Check 3: Runtime Connection, PING, & Ephemeral Key Round-trip
  // --------------------------------------------------------------------------
  console.log("\n🔌 [Check 3] Initiating runtime connection to configured Redis instance...");

  const rawEnvRedisUrl = process.env.REDIS_URL;
  if (!rawEnvRedisUrl) {
    console.error("❌ process.env.REDIS_URL is not set.");
    process.exit(1);
  }

  console.log("  Target Endpoint:", maskRedisUri(rawEnvRedisUrl));

  const client = createRedisInstance();
  let connectFired = false;
  let readyFired = false;

  client.on("connect", () => {
    connectFired = true;
    console.log("  🔌 Event: Socket connected (connect fired)");
  });

  client.on("ready", () => {
    readyFired = true;
    console.log("  ✅ Event: Client ready (ready fired)");
  });

  client.on("error", (err) => {
    console.warn("  ⚠️ Event: Client error:", maskRedisUri(err.message || String(err)));
  });

  try {
    // Attempt connection with 8s timeout
    const connectPromise = client.connect();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Connection attempt timed out after 8000ms")), 8000)
    );

    await Promise.race([connectPromise, timeoutPromise]);
    console.log("  ✅ Connection established successfully. Client status:", client.status);

    // 1. PING test
    console.log("\n  Testing PING command...");
    const pingResult = await client.ping();
    console.log(`  ✅ PING response: "${pingResult}"`);

    // 2. Ephemeral SET with 5-second TTL
    const testKey = `verify:smoke:${Date.now()}:${Math.random().toString(36).substring(2, 8)}`;
    const testValue = `test-payload-${Date.now()}`;
    console.log(`  Setting ephemeral key "${testKey}" with 5s TTL...`);

    const setResult = await client.set(testKey, testValue, "EX", 5);
    console.log(`  ✅ SET response: "${setResult}"`);

    // 3. GET readback
    const readValue = await client.get(testKey);
    if (readValue === testValue) {
      console.log(`  ✅ GET read-back verified matching payload: "${readValue}"`);
    } else {
      console.error(`  ❌ GET read-back mismatch: expected "${testValue}", got "${readValue}"`);
      failureCount++;
    }

    // 4. TTL check
    const remainingTtl = await client.ttl(testKey);
    console.log(`  ✅ Remaining TTL: ${remainingTtl}s (Expected: > 0 and <= 5)`);
    if (remainingTtl <= 0 || remainingTtl > 5) {
      console.warn("  ⚠️ Unexpected TTL range:", remainingTtl);
    }

    // 5. Cleanup
    await client.del(testKey);
    console.log("  ✅ Cleaned up temporary verification key.");
  } catch (err: any) {
    const masked = maskRedisUri(err?.message || String(err));
    console.error("  ❌ Runtime connection check failed:", masked);
    failureCount++;
  } finally {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  }

  // --------------------------------------------------------------------------
  // Summary & Exit Status
  // --------------------------------------------------------------------------
  console.log("\n================================================================");
  if (failureCount === 0) {
    console.log("🎉 ALL REDIS VERIFICATION CHECKS PASSED WITH ZERO ERRORS");
    console.log("================================================================\n");
    process.exit(0);
  } else {
    console.error(`💥 REDIS VERIFICATION FAILED WITH ${failureCount} ERROR(S)`);
    console.log("================================================================\n");
    process.exit(1);
  }
}

runVerification().catch((e) => {
  console.error("Unexpected unhandled error during verification:", e);
  process.exit(1);
});
