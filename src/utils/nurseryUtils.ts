import mongoose, { Types } from "mongoose";
import NurseryProfile from "../models/nurseryProfileModel";
import User from "../models/userModel";
import Product from "../models/productModel";
import ErrorHandler from "./errorHandler";
import cacheManager from "./cacheManager";

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
 * Global cache key for active nursery vendor user & profile IDs (5-minute TTL)
 */
export const ACTIVE_NURSERIES_CACHE_KEY = "nurseries:active_ids_list";

/**
 * 🛡️ SINGLE SOURCE OF TRUTH: Dual Identity Resolver for Nursery Multi-Vendor Domain
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

/**
 * ⚡ Fetch active & approved nursery user and profile IDs
 * A nursery is strictly active ONLY IF:
 * 1. Linked User: role === "nursery", isActive === true, isBlocked !== true, status === "Active"
 * 2. NurseryProfile: approvalStatus === "Approved", isActive === true, isBlocked !== true
 */
export const getActiveNurseryIds = async (): Promise<string[]> => {
  if (mongoose.connection.readyState !== 1) {
    return [];
  }
  return cacheManager.getOrSet(
    ACTIVE_NURSERIES_CACHE_KEY,
    async () => {
      // 1. Fetch active, unblocked, un-suspended users with role "nursery"
      const activeUsers = await User.find({
        role: "nursery",
        isActive: true,
        isBlocked: { $ne: true },
        status: { $regex: /^active$/i },
      })
        .select("_id")
        .lean();

      if (!activeUsers || activeUsers.length === 0) {
        return [];
      }

      const activeUserIds = activeUsers.map((u) => u._id);

      // 2. Fetch active and approved profiles belonging to these active users
      const activeProfiles = await NurseryProfile.find({
        nursery: { $in: activeUserIds },
        isActive: true,
        approvalStatus: { $regex: /^approved$/i },
        isBlocked: { $ne: true },
      })
        .select("nursery _id")
        .lean();

      const ids = new Set<string>();
      activeProfiles.forEach((p) => {
        if (p._id) ids.add(p._id.toString());
        if (p.nursery) ids.add(p.nursery.toString());
      });

      return Array.from(ids);
    },
    300 // 5 Minutes TTL
  );
};

/**
 * 🔒 Directly check if a specific nursery identity (Profile._id, User._id, or slug) is currently live & active
 */
export const isNurseryLiveAndActive = async (
  nurseryIdOrSlug: string | Types.ObjectId
): Promise<boolean> => {
  if (!nurseryIdOrSlug) return false;
  const activeIds = await getActiveNurseryIds();
  const idStr = nurseryIdOrSlug.toString().trim();

  if (activeIds.includes(idStr)) return true;

  // If slug was passed, check profile
  if (!mongoose.Types.ObjectId.isValid(idStr)) {
    const profile = await NurseryProfile.findOne({
      slug: idStr.toLowerCase().trim(),
      isActive: true,
      approvalStatus: { $regex: /^approved$/i },
      isBlocked: { $ne: true },
    })
      .select("_id nursery")
      .lean();

    if (profile) {
      if (
        activeIds.includes(profile._id.toString()) ||
        (profile.nursery && activeIds.includes(profile.nursery.toString()))
      ) {
        return true;
      }
    }
  }

  return false;
};

/**
 * 🛡️ Synchronously inspects a loaded nursery profile or user document.
 * Safely defaults to active unless explicitly suspended or deactivated.
 */
export const isNurseryActiveSync = (nursery: any): boolean => {
  if (!nursery) return true;

  if (typeof nursery === "string") {
    const lower = nursery.toLowerCase().trim();
    if (lower === "suspended" || lower === "inactive" || lower === "blocked" || lower === "rejected") {
      return false;
    }
    return true;
  }

  if (
    nursery.isActive === false ||
    nursery.active === false ||
    nursery.isBlocked === true ||
    nursery.isSuspended === true
  ) {
    return false;
  }

  const status = String(nursery.status || "").toLowerCase().trim();
  if (status === "suspended" || status === "inactive" || status === "blocked") {
    return false;
  }

  const approvalStatus = String(nursery.approvalStatus || "").toLowerCase().trim();
  if (approvalStatus === "rejected" || approvalStatus === "suspended" || approvalStatus === "blocked") {
    return false;
  }

  return true;
};

/**
 * 🧹 Invalidate all active nursery ID caches and nursery-specific profile caches
 */
export const invalidateNurseryCache = async (nurseryId?: string): Promise<void> => {
  const keysToDelete = [
    ACTIVE_NURSERIES_CACHE_KEY,
    "nurseries:active_ids",
  ];

  if (nurseryId) {
    const idStr = nurseryId.toString();
    keysToDelete.push(
      `nursery:${idStr}`,
      `nursery_profile:${idStr}`,
      `pname:nursery:${idStr}`
    );
  }

  // Clear in-memory geospatial cache if available
  try {
    const { clearGeoCaches } = await import("./pincodeService");
    clearGeoCaches();
  } catch {}

  await Promise.all(keysToDelete.map((key) => cacheManager.del(key)));

  await Promise.all([
    cacheManager.invalidatePattern("nurseries:"),
    cacheManager.invalidatePattern("geo:nurseries:"),
    cacheManager.invalidatePattern("catalog:"),
    cacheManager.invalidatePattern("products:"),
    nurseryId
      ? cacheManager.invalidatePattern(`nursery:${nurseryId}:`)
      : cacheManager.invalidatePattern("nursery:"),
  ]);
};

/**
 * 🔄 Synchronize product visibility flag (`isNurseryActive`) for a nursery
 */
export const syncNurseryProductsActiveStatus = async (
  nurseryUserIdOrProfileId: string | Types.ObjectId,
  isActive: boolean
): Promise<number> => {
  try {
    const resolved = await resolveNurseryIdentity(nurseryUserIdOrProfileId);
    const idStrings = resolved.allIds.map((id) => id.toString());
    const idObjectIds = resolved.allIds;
    const allQueryIds = [...idStrings, ...idObjectIds];

    const result = await Product.updateMany(
      {
        $or: [
          { nursery: { $in: allQueryIds } },
          { nurseryId: { $in: allQueryIds } },
          { vendor: { $in: allQueryIds } },
        ],
      },
      { $set: { isNurseryActive: isActive } }
    );
    await invalidateNurseryCache(resolved.profileId.toString());
    await invalidateNurseryCache(resolved.userId.toString());
    return result.modifiedCount;
  } catch (err: any) {
    console.error("Failed to sync nursery products active status:", err);
    return 0;
  }
};
