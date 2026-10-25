import express from "express";
import cookieParser from "cookie-parser";
import fileUpload from "express-fileupload";
import cors from "cors";
import compression from "compression";
import mainRouter from "./routes";
import errorMiddleware from "./middleware/error";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import mongoose from "mongoose";
import { normalizeOrigin } from "./utils/security";
import { validateUploadedFiles } from "./middleware/fileValidate";
import ErrorHandler from "./utils/errorHandler";

const app = express();

// ======================================================================
// 👑 RENDER DEPLOYMENT PROXIES CONFIGURATION
// ======================================================================
app.set("trust proxy", 1);

// ======================================================================
// 🛡️ HTTP SECURITY HEADERS LAYER
// ======================================================================
app.use(helmet());

// ======================================================================
// 🗜️ PERFORMANCE COMPRESSION LAYER
// ======================================================================
app.use(
  compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
  })
);

// ======================================================================
// ⚙️ GLOBAL MIDDLEWARES (Security & Parsing Optimized)
// ======================================================================
const frontendUrl = process.env.FRONTEND_URL;
const allowedOrigins = new Set<string>([
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "https://urbannursery.in",
  "https://planto-frontend-mpdo.onrender.com",
  "https://nursery-backend-2rg3.onrender.com/",
  "https://urbannursery.vercel.app",
  "https://urbannursery-neon.vercel.app/"

]);
if (frontendUrl) {
  frontendUrl.split(",").forEach((url) => {
    const trimmed = normalizeOrigin(url.trim());
    if (trimmed) {
      allowedOrigins.add(trimmed);
    }
  });
}

const isOriginAllowed = (origin?: string): boolean => {
  if (!origin) return true;
  let normalized = normalizeOrigin(origin);
  try {
    normalized = new URL(normalized).origin;
  } catch {
    // If invalid URL, keep normalized string
  }

  if (allowedOrigins.has(normalized)) {
    return true;
  }

  // Allow localhost / 127.0.0.1 development ports strictly in non-production environments
  if (process.env.NODE_ENV !== "production") {
    try {
      const parsedUrl = new URL(normalized);
      if (
        (parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1") &&
        (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
};

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) {
        return callback(null, true);
      }
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      // Reject disallowed origins cleanly so CORS blocks them
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
    optionsSuccessStatus: 204,
  })
);

app.use(
  express.json({
    limit: "10mb",
    verify: (req: any, res, buf) => {
      if (req.originalUrl && req.originalUrl.includes("/payment/webhook")) {
        req.rawBody = buf.toString();
      }
    },
  })
);

app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// ======================================================================
// 🛡️ ISOLATED RATE LIMITING STRUCTURAL LAYERS
// ======================================================================
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many attempts from this IP, try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// 🤖 CRAWLER DETECTION: Allow verified search engines (Googlebot, Bingbot, etc.) without false-positive 429 throttling
const isSearchEngineBot = (req: express.Request): boolean => {
  const ua = (req.headers["user-agent"] as string) || "";
  return /Googlebot|bingbot|Baiduspider|DuckDuckBot|YandexBot/i.test(ua);
};

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { success: false, message: "Too many requests from this IP, please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (req.originalUrl && req.originalUrl.includes("/payment/webhook")) return true;
    if (isSearchEngineBot(req)) return true;
    return false;
  },
});

const newsletterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many newsletter requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ✨ FIXED: Both structural user prefixes and explicit auth prefixes are now fully secured
app.use("/api/v1/users/login", authLimiter);
app.use("/api/v1/users/register", authLimiter);
app.use("/api/v1/users/social-login", authLimiter);
app.use("/api/v1/users/password/forgot", authLimiter);
app.use("/api/v1/users/nursery-login", authLimiter);
app.use("/api/v1/users/admin-login", authLimiter);
app.use("/api/v1/auth/login", authLimiter);
app.use("/api/v1/auth/register", authLimiter);
app.use("/api/v1/auth/social-login", authLimiter);
app.use("/api/v1/auth/password/forgot", authLimiter);
app.use("/api/v1/dashboard/login", authLimiter);
app.use("/api/v1/newsletter/subscribe", newsletterLimiter);
app.use("/api/v1/newsletter/unsubscribe", newsletterLimiter);
app.use("/api/newsletter/subscribe", newsletterLimiter);
app.use("/api/newsletter/unsubscribe", newsletterLimiter);

// ======================================================================
// 📂 FILE UPLOAD HANDLING PIPELINE WITH EXTENSION SECURITY SENSOR
// ======================================================================
const uploadDir = path.join(os.tmpdir(), "urban_nursery_uploads");
if (!fs.existsSync(uploadDir)) {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
  } catch (e) {
    console.error("[app] Could not create temp upload dir:", e);
  }
}

app.use(
  fileUpload({
    useTempFiles: true,
    tempFileDir: uploadDir,
    limits: { fileSize: 10 * 1024 * 1024 },
    createParentPath: true,
  })
);

const csrfGuard = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const usesCookieAuth = Boolean(req.cookies?.token) && !req.headers.authorization;
  if (!usesCookieAuth) return next();
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.originalUrl.includes("/payment/webhook")) return next();

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (!origin && !referer) {
    return next(new ErrorHandler("Origin validation failed", 403));
  }

  const requestOrigin = normalizeOrigin(origin || referer || "");
  if (!isOriginAllowed(requestOrigin)) {
    return next(new ErrorHandler("Cross-site request denied", 403));
  }

  next();
};

// ======================================================================
// 🏥 SYSTEM MONITORING LABELS (HEALTH ROUTE WITH READINESS CHECK)
// ======================================================================
app.get("/health", (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  const isDbHealthy = dbStatus === 1; // 1 means connected

  if (!isDbHealthy) {
    return res.status(503).json({
      success: false,
      status: "DOWN",
      database: "DISCONNECTED",
      timestamp: new Date(),
      uptime: process.uptime(),
    });
  }

  // ✨ FIXED: Added 'return' here to satisfy TypeScript's strict code-path routing check
  return res.status(200).json({
    success: true,
    status: "UP",
    database: "CONNECTED",
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// ======================================================================
// 🛣️ APPLICATION BASE ROUTES (/api/v1 and backwards-compatible /api)
// ======================================================================
// 🛡️ ROBOTS SHIELD: Internal API endpoints should never be indexed directly
const apiRobotsShield = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
};

app.use("/api/v1", apiRobotsShield, apiLimiter, csrfGuard, validateUploadedFiles({ allowVideo: false }), mainRouter);
app.use("/api", apiRobotsShield, apiLimiter, csrfGuard, validateUploadedFiles({ allowVideo: false }), mainRouter);

app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Can't find ${req.originalUrl} on this server!`
  });
});

app.use(errorMiddleware);

export default app;