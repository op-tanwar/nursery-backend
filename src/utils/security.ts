import crypto from "node:crypto";

export const hashToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

export const normalizeOrigin = (origin: string): string => {
  return origin.endsWith("/") ? origin.slice(0, -1) : origin;
};
