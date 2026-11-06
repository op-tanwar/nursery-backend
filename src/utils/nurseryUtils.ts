import mongoose, { Types } from "mongoose";
import NurseryProfile from "../models/nurseryProfileModel";
import ErrorHandler from "./errorHandler";

export interface ResolvedNurseryIdentity {
  /** The canonical multi-vendor storefront ID (NurseryProfile._id) */
  profileId: Types.ObjectId;
  /** The linked authentication account ID (User._id) */
  userId: Types.ObjectId;
  /** Array of both [profileId, userId] for defensive, 100% backward-compatible MongoDB $in matching */
  allIds: Types.ObjectId[];
  /** Loaded nursery profile document if found */
  profile: any;
}

/**
 * 🛡️ SINGLE SOURCE OF TRUTH: Dual Identity Resolver for Nursery Multi-Vendor Domain
 *
 * Problem:
 * - Products and Order line-items store `orderItems.nursery` as `NurseryProfile._id`.
 * - Nursery auth contexts and session tokens provide `req.user._id` (the User model ID).
 * - Because User._id !== NurseryProfile._id, querying orderItems with req.user._id matches 0 records.
 *
 * Solution:
 * This helper dynamically resolves both the canonical `NurseryProfile._id` and linked `User._id`
 * regardless of which one is supplied by the caller, returning `allIds` for safe `$in` aggregations.
 */
export async function resolveNurseryIdentity(
  inputNurseryOrUserId?: Types.ObjectId | string | null,
  options?: { requireProfile?: boolean }
): Promise<ResolvedNurseryIdentity> {
  if (!inputNurseryOrUserId) {
    throw new ErrorHandler("Nursery or user identity reference is required", 400);
  }

  const rawIdStr = inputNurseryOrUserId.toString().trim();
  if (!mongoose.Types.ObjectId.isValid(rawIdStr)) {
    throw new ErrorHandler(`Invalid nursery identity ID format: "${rawIdStr}"`, 400);
  }

  const targetObjectId = new Types.ObjectId(rawIdStr);

  // 1. Try finding NurseryProfile where nursery == inputId OR _id == inputId
  let profile = await NurseryProfile.findOne({
    $or: [{ nursery: targetObjectId }, { _id: targetObjectId }],
  }).lean();

  if (!profile) {
    if (options?.requireProfile) {
      throw new ErrorHandler(`Nursery profile not found for identity: ${rawIdStr}`, 404);
    }
    // Defensive fallback: Treat targetObjectId as both profileId and userId
    return {
      profileId: targetObjectId,
      userId: targetObjectId,
      allIds: [targetObjectId],
      profile: null,
    };
  }

  const profileId = new Types.ObjectId(String(profile._id));
  const rawUserId = profile.nursery?._id || profile.nursery;
  const userId = rawUserId ? new Types.ObjectId(String(rawUserId)) : profileId;

  // Build unique allIds list
  const allIds: Types.ObjectId[] = [profileId];
  if (profileId.toString() !== userId.toString()) {
    allIds.push(userId);
  }

  return {
    profileId,
    userId,
    allIds,
    profile,
  };
}
