import { CookieOptions, Request } from "express";

export interface CookieConfigOptions {
  httpOnly?: boolean;
  maxAgeDays?: number;
}

/**
 * Returns environment-aware cookie options for authentication cookies.
 *
 * Requirements satisfied:
 * - Production: sameSite="none", secure=true, domain omitted (host-only) or explicit parent domain.
 * - Development: sameSite="lax", secure=false.
 * - Reverse Proxy Aware: detects req.secure and x-forwarded-proto=https.
 * - Path: always "/"
 */
export const getAuthCookieOptions = (
  req?: Request,
  customOptions?: CookieConfigOptions
): CookieOptions => {
  const isEnvProd = process.env.NODE_ENV === "production";
  const isHttps = Boolean(
    req?.secure ||
    req?.headers?.["x-forwarded-proto"] === "https" ||
    isEnvProd
  );

  const isProduction = isEnvProd || isHttps;
  const maxAgeDays = customOptions?.maxAgeDays ?? parseInt(process.env.COOKIE_EXPIRES_TIME || "7", 10);
  const validDays = isNaN(maxAgeDays) ? 7 : maxAgeDays;

  // Domain behavior:
  // When frontend (e.g. *.vercel.app) and backend (e.g. *.onrender.com) reside on different parent domains,
  // the domain attribute MUST be omitted (undefined) to yield a host-only cookie.
  // Setting an explicit domain is only permissible when sharing subdomains under a common apex (e.g. .example.com).
  const cookieDomain = process.env.COOKIE_DOMAIN ? process.env.COOKIE_DOMAIN.trim() : undefined;

  return {
    path: "/",
    domain: cookieDomain,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    httpOnly: customOptions?.httpOnly ?? true,
    maxAge: validDays * 24 * 60 * 60 * 1000,
  };
};

/**
 * Returns cookie options matching getAuthCookieOptions to guarantee proper deletion via res.clearCookie().
 * Browsers will only delete a cookie if domain, path, sameSite, and secure attributes match its creation signature.
 */
export const getClearCookieOptions = (
  req?: Request,
  customOptions?: Pick<CookieConfigOptions, "httpOnly">
): CookieOptions => {
  const authOptions = getAuthCookieOptions(req, customOptions);

  return {
    path: authOptions.path,
    domain: authOptions.domain,
    secure: authOptions.secure,
    sameSite: authOptions.sameSite,
    httpOnly: authOptions.httpOnly,
  };
};
