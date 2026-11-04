import { OAuth2Client } from "google-auth-library";
import axios from "axios";
import User, { IUser } from "../models/userModel";
import ErrorHandler from "../utils/errorHandler";
import { sendWelcomeEmail } from "../utils/orderEmailService";

export interface GoogleUserProfile {
  provider: "google";
  providerId: string;
  email: string;
  name: string;
  picture?: string;
  emailVerified: boolean;
}

/**
 * Lazy initializer for OAuth2Client to ensure environment variables are loaded
 */
function getGoogleOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  return new OAuth2Client(clientId);
}

/**
 * 1. Verify Google Token (ID Token using google-auth-library, with access token fallback)
 */
export async function verifyGoogleToken(token: string): Promise<GoogleUserProfile> {
  if (!token) {
    throw new ErrorHandler("Google token is required", 400);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const isJwt = token.split(".").length === 3;

  // Primary Flow: OpenID Connect ID Token (JWT) verification
  if (isJwt) {
    try {
      const client = getGoogleOAuthClient();
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: clientId ? [clientId] : undefined,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        throw new ErrorHandler("Invalid Google token payload", 400);
      }

      if (!payload.email) {
        throw new ErrorHandler("No email associated with this Google account", 400);
      }

      if (!payload.email_verified) {
        throw new ErrorHandler("Google account email is not verified", 403);
      }

      return {
        provider: "google",
        providerId: payload.sub,
        email: payload.email.toLowerCase().trim(),
        name: payload.name || payload.email.split("@")[0],
        picture: payload.picture,
        emailVerified: Boolean(payload.email_verified),
      };
    } catch (error: any) {
      if (error instanceof ErrorHandler) throw error;
      console.warn("verifyIdToken attempt failed, trying Google userinfo endpoint fallback:", error.message || error);
    }
  }

  // Secondary Fallback: OAuth 2.0 Access Token verification via Google UserInfo API
  try {
    const response = await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 10000,
    });

    const data = response.data;
    if (!data || !data.sub) {
      throw new ErrorHandler("Invalid Google profile response", 400);
    }

    if (!data.email) {
      throw new ErrorHandler("No email associated with this Google account", 400);
    }

    if (!data.email_verified) {
      throw new ErrorHandler("Google account email is not verified", 403);
    }

    return {
      provider: "google",
      providerId: data.sub,
      email: data.email.toLowerCase().trim(),
      name: data.name || data.email.split("@")[0],
      picture: data.picture,
      emailVerified: Boolean(data.email_verified),
    };
  } catch (error: any) {
    if (error instanceof ErrorHandler) throw error;
    console.error("Google token verification failed:", error.response?.data || error.message);
    const desc = error.response?.data?.error_description || error.message;
    throw new ErrorHandler(`Google verification failed: ${desc || "Invalid or expired token"}`, 401);
  }
}

/**
 * Allowed roles that can be self-assigned during public social registration.
 *
 * SECURITY NOTE:
 * "admin" accounts CANNOT be provisioned via public OAuth or self-registration.
 * Super-admin accounts must only be provisioned via internal seed scripts,
 * direct database migrations, or an authenticated super-admin dashboard by an
 * existing administrator.
 */
export type AllowedPublicRole = "user" | "nursery";
const ALLOWED_PUBLIC_ROLES: readonly AllowedPublicRole[] = ["user", "nursery"] as const;

/**
 * 2. Find or Create / Merge Google Social Account
 */
export async function authenticateSocialUser(
  provider: "google",
  token: string,
  preferredRole?: string
): Promise<IUser> {
  if (provider !== "google") {
    throw new ErrorHandler("Only Google authentication is currently supported", 400);
  }

  // 🛡️ ROLE VALIDATION & PRIVILEGE ESCALATION GUARD
  let resolvedRole: AllowedPublicRole = "user";
  if (preferredRole) {
    const cleanRole = String(preferredRole).trim().toLowerCase();
    if (cleanRole === "admin") {
      throw new ErrorHandler(
        "Access Denied: Administrator accounts cannot be self-provisioned via social authentication.",
        400
      );
    }
    if (!ALLOWED_PUBLIC_ROLES.includes(cleanRole as AllowedPublicRole)) {
      throw new ErrorHandler(
        `Invalid registration role "${preferredRole}". Allowed roles are: ${ALLOWED_PUBLIC_ROLES.join(", ")}.`,
        400
      );
    }
    resolvedRole = cleanRole as AllowedPublicRole;
  }

  const profile = await verifyGoogleToken(token);

  if (!profile.emailVerified) {
    throw new ErrorHandler("Google account email is not verified. Account cannot be linked.", 403);
  }

  // Check if user already exists by googleId or email
  let user = await User.findOne({
    $or: [{ googleId: profile.providerId }, { email: profile.email }],
  });

  if (user) {
    // Check if user is blocked or suspended
    if (user.isBlocked || user.status === "Blocked") {
      throw new ErrorHandler("Your account has been blocked. Please contact support.", 403);
    }
    if (user.status === "Suspended") {
      throw new ErrorHandler("Your account is currently suspended. Please contact support.", 403);
    }

    // 🔒 SECURITY GUARD: Existing user's role MUST be preserved.
    // NEVER overwrite or mutate user.role with preferredRole from client payload.
    let modified = false;

    // Link googleId to existing account if not yet attached
    if (!user.googleId) {
      user.googleId = profile.providerId;
      modified = true;
    }

    // Update avatar if currently default or placeholder
    if (
      profile.picture &&
      (!user.avatar?.url ||
        user.avatar.url.includes("cloudinary.com/demo/image/upload/v1312461204/sample.jpg") ||
        user.avatar.public_id === "avatars/default_id")
    ) {
      user.avatar = {
        public_id: `google_avatar_${profile.providerId}`,
        url: profile.picture,
      };
      modified = true;
    }

    if (modified) {
      await user.save({ validateBeforeSave: false });
    }
  } else {
    // Create brand new user via Google OAuth with strictly validated public role
    let oauthName = (profile.name || profile.email.split("@")[0] || "User").trim();
    if (oauthName.length < 2) {
      oauthName = `${oauthName} User`;
    }
    if (oauthName.length > 70) {
      oauthName = oauthName.substring(0, 70).trim();
    }

    user = await User.create({
      name: oauthName,
      email: profile.email,
      authProvider: "google",
      googleId: profile.providerId,
      role: resolvedRole,
      avatar: profile.picture
        ? {
            public_id: `google_avatar_${profile.providerId}`,
            url: profile.picture,
          }
        : {
            public_id: "avatars/default_id",
            url: "https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg",
          },
      isActive: true,
      status: "Active",
    });

    // Fire welcome email asynchronously without blocking
    sendWelcomeEmail(user.name, user.email).catch((e) => {
      console.error("[authService] Welcome email dispatch failed for Google user:", e);
    });
  }

  return user;
}
