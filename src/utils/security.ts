import crypto from "node:crypto";

export const hashToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

/**
 * Normalizes an origin or URL string down to its canonical origin (protocol + host[:port]).
 * Strips paths, query strings, trailing slashes, and ensures lowercase formatting.
 */
export const normalizeOrigin = (origin?: string): string => {
  if (!origin) return "";
  const trimmed = origin.trim();
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
};
