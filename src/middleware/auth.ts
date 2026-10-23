import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import ErrorHandler from "../utils/errorHandler";
import catchAsyncErrors from "./catchAsyncErrors";
import User from "../models/userModel";
import BlacklistedToken from "../models/blacklistedTokenModel"; // 🛡️ Blacklist model import kiya gaya
import "../types/api.types";
import { hashToken } from "../utils/security";

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
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];

    if (!token) {
      return next(new ErrorHandler("Please login to access this resource", 401));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string, {
        algorithms: ["HS256"],
      }) as DecodedTokenPayload;

      // 🔒 FIXED: Enforce token blacklist check to prevent using logged-out/stolen JWTs
      const tokenHash = hashToken(token);
      const isBlacklisted = await BlacklistedToken.findOne({
        $or: [{ tokenHash }, { token }],
      });
      if (isBlacklisted) {
        return next(new ErrorHandler("Session has been terminated or logged out.", 401));
      }

      // ⚡ PRODUCTION IMPROVEMENT: Optional Redis check instead of MongoDB scan
      // const isRevoked = await redis.get(`blacklist:${decoded.jti}`);
      // if (isRevoked) return next(new ErrorHandler("Session has been terminated.", 401));

      // 🔒 FIXED: Combined profile query and validation paths in a single execution sweep
      const user = await User.findById(decoded.id).select("+role +isActive +isBlocked +status");

      if (!user) {
        return next(new ErrorHandler("User session has expired or account no longer exists.", 401));
      }

      // 🛡️ REAL-TIME VALIDATION GUARD:
      const userData: any = user;
      if (
        userData.isActive === false ||
        userData.isBlocked === true ||
        userData.status === "Suspended" ||
        userData.status === "Blocked"
      ) {
        return next(new ErrorHandler("Your account has been deactivated/blocked by admin.", 403));
      }

      req.user = user;
      next();
    } catch (err) {
      return next(new ErrorHandler("Invalid/Expired token sequence", 401));
    }
  }
);

// ------------------------------
// OPTIONAL AUTH MIDDLEWARE
// ------------------------------
export const optionalAuthenticateUser = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.token || req.headers?.authorization?.split(" ")[1];

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
        const userData: any = user;
        if (
          userData.isActive !== false &&
          userData.isBlocked !== true &&
          userData.status !== "Suspended" &&
          userData.status !== "Blocked"
        ) {
          req.user = user;
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