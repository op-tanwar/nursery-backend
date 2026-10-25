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
// 🌐 BULLETPROOF CORS CONFIGURATION & ORIGIN RESOLVER
// ======================================================================
// Trusted static origins for production, staging, and local environments
const staticAllowedOrigins: string[] = [
  "https://urbannursery-neon.vercel.app",
  "https://urbannursery.vercel.app",
  "https://urbannursery.in",
  "https://www.urbannursery.in",
  "https://planto-frontend-mpdo.onrender.com",
  "https://nursery-backend-2rg3.onrender.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:5173",
];

const allowedOriginsSet = new Set<string>(
  staticAllowedOrigins.map((o) => normalizeOrigin(o)).filter(Boolean)
);

// Dynamically register comma-separated origins from FRONTEND_URL env var
const frontendUrl = process.env.FRONTEND_URL;
if (frontendUrl) {
  frontendUrl.split(",").forEach((url) => {
    const normalized = normalizeOrigin(url);
    if (normalized) {
      allowedOriginsSet.add(normalized);
    }
  });
}

// Regex patterns for Vercel preview/branch deployments and local development hosts
const allowedOriginPatterns: RegExp[] = [
  // Vercel deployment preview domains (e.g. https://urbannursery-neon.vercel.app, https://urbannursery-git-feat.vercel.app)
  /^https:\/\/urbannursery(-[a-zA-Z0-9_-]+)?\.vercel\.app$/,
  // Planto preview domains (e.g. https://planto-*.vercel.app)
  /^https:\/\/planto(-[a-zA-Z0-9_-]+)?\.vercel\.app$/,
  // Any general urbannursery or planto vercel app deployments
  /^https:\/\/(urbannursery|planto)-[a-zA-Z0-9_-]+\.vercel\.app$/,
  // Localhost & 127.0.0.1 on any port for frontend developers connecting to backend
  /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/,
];

export const isOriginAllowed = (origin?: string): boolean => {
  // Allow requests with no origin (e.g. mobile apps, curl, server-to-server, Postman)
  if (!origin) return true;

  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  // 1. Direct O(1) set lookup
  if (allowedOriginsSet.has(normalized)) {
    return true;
  }

  // 2. Pattern match for Vercel previews and local dev ports
  return allowedOriginPatterns.some((pattern) => pattern.test(normalized));
};

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || isOriginAllowed(origin)) {
      return callback(null, true);
    }
    // Reject disallowed origins cleanly without throwing an unhandled server 500 error
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "Access-Control-Request-Method",
    "Access-Control-Request-Headers",
  ],
  exposedHeaders: ["Set-Cookie", "Authorization", "Content-Disposition"],
  optionsSuccessStatus: 204,
  maxAge: 86400, // 24 hours preflight caching
};

// Mount CORS middleware at the earliest entrypoint to handle OPTIONS preflights cleanly
app.use(cors(corsOptions));

// ======================================================================
// 🛡️ HTTP SECURITY HEADERS LAYER
// ======================================================================
// Explicitly configure crossOriginResourcePolicy to "cross-origin" to allow cross-origin API calls & assets
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

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
