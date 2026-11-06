import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import ErrorHandler from "../utils/errorHandler";
import catchAsyncErrors from "./catchAsyncErrors";
import User from "../models/userModel";
import NurseryProfile from "../models/nurseryProfileModel";
import BlacklistedToken from "../models/blacklistedTokenModel";
import "../types/api.types";
import { hashToken } from "../utils/security";
import {
  assertAccountActive,
  assertNurseryProfileActive,
} from "../utils/authGuard";

interface DecodedTokenPayload {
  id: string;
  role?: string;
  jti: string;
  iat: number;
  exp: number;
}

// ------------------------------
// AUTH MIDDLEWARE WITH REVOCATION
// ------------------------------
export const isAuthenticatedUser = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    let token = req.cookies?.token;

    // Strict Cookie Authentication: browser origins MUST use httpOnly cookies
    if (!token) {
      const isBrowserRequest = Boolean(
        req.headers.origin ||
        req.headers.referer ||
        req.headers["sec-fetch-dest"] ||
        req.headers["sec-fetch-mode"]
      );

      // Authorization header is permitted exclusively for external non-browser service calls / webhooks
      if (!isBrowserRequest && req.headers.authorization) {
        token = req.headers.authorization.split(" ")[1];
      }
    }

    if (!token) {
      return next(new ErrorHandler("Please login to access this resource", 401));
    }

    let decoded: DecodedTokenPayload;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET as string, {
        algorithms: ["HS256"],
      }) as DecodedTokenPayload;
    } catch {
      return next(new ErrorHandler("Invalid/Expired token sequence", 401));
    }

    // 🔒 FIXED: Enforce token blacklist check to prevent using logged-out/stolen JWTs
    const tokenHash = hashToken(token);
    const isBlacklisted = await BlacklistedToken.findOne({
      $or: [{ tokenHash }, { token }],
    });
    if (isBlacklisted) {
      return next(new ErrorHandler("Session has been terminated or logged out.", 401));
    }

    // 🔒 FIXED: Combined profile query and validation paths in a single execution sweep
    const user = await User.findById(decoded.id).select("+role +isActive +isBlocked +status");

    if (!user) {
      return next(new ErrorHandler("User session has expired or account no longer exists.", 401));
    }

    // 🛡️ REAL-TIME VALIDATION GUARD:
    // Ensures accounts blocked or deactivated after token generation are immediately rejected with 403 Forbidden
    assertAccountActive(user);

    // If nursery vendor, verify linked NurseryProfile is also active and not rejected
    if (user.role === "nursery") {
      const nurseryProfile = await NurseryProfile.findOne({ nursery: user._id }).lean();
      if (nurseryProfile) {
        assertNurseryProfileActive(nurseryProfile);
      }
    }

    req.user = user;
    next();
  }
);

// ------------------------------
// OPTIONAL AUTH MIDDLEWARE
// ------------------------------
export const optionalAuthenticateUser = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    let token = req.cookies?.token;

    if (!token) {
      const isBrowserRequest = Boolean(
        req.headers.origin ||
        req.headers.referer ||
        req.headers["sec-fetch-dest"] ||
        req.headers["sec-fetch-mode"]
      );

      if (!isBrowserRequest && req.headers?.authorization) {
        token = req.headers.authorization.split(" ")[1];
      }
    }

    if (!token) {
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string, {
        algorithms: ["HS256"],
      }) as DecodedTokenPayload;

      const tokenHash = hashToken(token);
      const isBlacklisted = await BlacklistedToken.findOne({
        $or: [{ tokenHash }, { token }],
      });
      if (isBlacklisted) {
        return next();
      }

      const user = await User.findById(decoded.id).select("+role +isActive +isBlocked +status");
      if (user) {
        try {
          assertAccountActive(user);
          if (user.role === "nursery") {
            const nurseryProfile = await NurseryProfile.findOne({ nursery: user._id }).lean();
            if (nurseryProfile) {
              assertNurseryProfileActive(nurseryProfile);
            }
          }
          req.user = user;
        } catch {
          // Deactivated or blocked, do not attach as authenticated user
        }
      }
    } catch {
      // Token expired or invalid, silently proceed as guest
    }

    next();
  }
);

// ------------------------------
// ROLE AUTHORIZATION
// ------------------------------
export const authorizeRoles = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ErrorHandler("User not authenticated", 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        new ErrorHandler(
          `Role: ${req.user.role} is not allowed to access this resource`,
          403
        )
      );
    }

    next();
  };
};
