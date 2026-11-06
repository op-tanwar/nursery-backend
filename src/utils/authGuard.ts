import { IUser } from "../models/userModel";
import ErrorHandler from "./errorHandler";

export const AppError = ErrorHandler;

/**
 * 🔒 Strict centralized account lifecycle assertion
 * Blocks suspended, deactivated, or blocked accounts across all roles (user, nursery, admin).
 * Ensures that blocked accounts cannot authenticate, mint JWT tokens, or bypass middleware.
 *
 * @param user User document or plain object containing account lifecycle flags
 * @throws {ErrorHandler} 403 Forbidden if account is blocked, deactivated, or suspended
 */
export const assertAccountActive = (user: IUser | any): void => {
  if (!user) {
    throw new ErrorHandler("User account not found.", 401);
  }

  // 1. Validate boolean blocked flag
  if (user.isBlocked) {
    throw new ErrorHandler(
      "Your account has been suspended or blocked by an administrator.",
      403
    );
  }

  // 2. Validate boolean active flag (strictly false; undefined defaults to active in Mongoose schema)
  if (user.isActive === false) {
    throw new ErrorHandler(
      "Your account is deactivated. Please contact support to reactivate.",
      403
    );
  }

  // 3. Validate lifecycle status enum string (case-insensitive normalization)
  if (
    user.status &&
    typeof user.status === "string" &&
    ["blocked", "suspended", "inactive", "deactivated"].includes(
      user.status.trim().toLowerCase()
    )
  ) {
    throw new ErrorHandler("Account is not in active state.", 403);
  }
};

/**
 * 🔒 Strict nursery vendor profile lifecycle assertion
 * Validates linked NurseryProfile status (e.g., rejection, deactivation, suspension).
 *
 * @param profile NurseryProfile document or plain object
 * @throws {ErrorHandler} 403 Forbidden if nursery profile is blocked, deactivated, or rejected
 */
export const assertNurseryProfileActive = (profile: any): void => {
  if (!profile) return;

  // 1. Validate boolean blocked flag
  if (profile.isBlocked) {
    throw new ErrorHandler(
      "Your nursery profile has been blocked by an administrator.",
      403
    );
  }

  // 2. Validate boolean active flag
  if (profile.isActive === false) {
    throw new ErrorHandler(
      "Your nursery account has been deactivated. Please contact support.",
      403
    );
  }

  // 3. Validate application approval status (rejected applications cannot log in to dashboard)
  if (
    profile.approvalStatus &&
    typeof profile.approvalStatus === "string" &&
    profile.approvalStatus.trim().toLowerCase() === "rejected"
  ) {
    throw new ErrorHandler(
      profile.rejectionReason
        ? `Your nursery partner application was rejected: ${profile.rejectionReason}`
        : "Your nursery partner application has been rejected.",
      403
    );
  }

  // 4. Validate profile status enum if present
  if (
    profile.status &&
    typeof profile.status === "string" &&
    ["blocked", "suspended", "inactive", "deactivated"].includes(
      profile.status.trim().toLowerCase()
    )
  ) {
    throw new ErrorHandler("Nursery profile is not in active state.", 403);
  }
};
