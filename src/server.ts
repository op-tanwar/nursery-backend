// ======================================================================
// 🛡️ 1. SAFE ZONE: REGISTER CRASH LISTENERS BEFORE ANY MODULE IMPORTS
// ======================================================================
process.on("uncaughtException", (err: Error) => {
  console.error(`❌ CRITICAL: Uncaught Exception - ${err.message}`);
  console.error(err.stack);
  console.log("Shutting down the server due to uncaught exception...");
  process.exit(1);
});

// Dotenv configuration initialization
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

// Unified env configuration path logic
const rootEnvPath = path.resolve(process.cwd(), ".env");

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

import app from "./app";
import connectDatabase from "./database/database";
import cloudinary from "cloudinary";
import { Server } from "http";
import mongoose from "mongoose";
import { validateEnvironment } from "./utils/env";
import { warmPincodeIndex, getServiceRadiusKm } from "./utils/pincodeService";
import { verifyEmailConnection } from "./utils/sendEmail";
import {
  startStockReservationWorker,
  stopStockReservationWorker,
} from "./services/stockReservationService";

// ======================================================================
// ☁️ 2. THIRD-PARTY SERVICES CONFIGURATION
// ======================================================================
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ======================================================================
// 🚀 3. SERVER BOOTSTRAP LIFECYCLE
// ======================================================================
const PORT = process.env.PORT || 5000;
let server: Server;

const startServer = async () => {
  try {
    validateEnvironment();
    await connectDatabase();
    await verifyEmailConnection();

    // 🧹 Initialize Stock Reservation TTL Sweeper Worker (runs every 60s)
    startStockReservationWorker(60000);

    try {
      warmPincodeIndex();
      console.log(
        `📍 Nursery service coverage radius: ${getServiceRadiusKm()} km (NURSERY_SERVICE_RADIUS_KM)`
      );
    } catch (error) {
      console.error("❌ Failed to warm pincode geo index:", error);
    }

    server = app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Database initialization connection failed during startup:", error);
    process.exit(1);
  }
};

startServer();

// ======================================================================
// 🛡️ 4. UNHANDLED ASYNC PROMISE REJECTIONS GUARD
// ======================================================================
process.on("unhandledRejection", (err: any) => {
  console.error(`❌ CRITICAL: Unhandled Promise Rejection - ${err?.message || err}`);
  if (err?.stack) console.error(err.stack);
  console.log("Shutting down the server due to unhandled promise rejection...");

  if (server) {
    server.close(() => {
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
});

// ======================================================================
// 🛑 5. SYSTEM RECLAMATION PROCESS LIFECYCLES (GRACEFUL SHUTDOWN)
// ======================================================================
const handleGracefulShutdown = (signal: string) => {
  console.log(`\n🛑 System received ${signal}. Initiating graceful lifecycle termination pipeline...`);

  // Stop background reservation sweeper worker cleanly
  stopStockReservationWorker();

  // Safety forcing switch if hanging processes refuse release controls
  const forceShutdownTimeout = setTimeout(() => {
    console.error("⚠️ Graceful timeout threshold reached. Forcing direct container shutdown.");
    process.exit(1);
  }, 10000);

  if (server) {
    server.close(async () => {
      console.log("🌲 HTTP Infrastructure pools safely offline. Connection channels decoupled.");

      try {
        // Clean database disconnection process
        await mongoose.connection.close(false);
        console.log("🍃 MongoDB connection connection pool closed gracefully.");

        clearTimeout(forceShutdownTimeout);
        process.exit(0);
      } catch (err) {
        console.error("❌ Error while closing database pool during shutdown:", err);
        process.exit(1);
      }
    });
  } else {
    process.exit(0);
  }
};

process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));
process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));