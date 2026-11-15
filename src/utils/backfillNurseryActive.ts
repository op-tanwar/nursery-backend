import mongoose, { Types } from "mongoose";
import User from "../models/userModel";
import NurseryProfile from "../models/nurseryProfileModel";
import Product from "../models/productModel";
import { invalidateNurseryCache, getActiveNurseryIds } from "./nurseryUtils";

export interface SyncResult {
  success: boolean;
  activeNurseriesCount: number;
  activeProductsUpdated: number;
  suspendedProductsUpdated: number;
  totalProductsCount: number;
  timestamp: string;
}

/**
 * 🔄 PLATFORM-WIDE NURSERY VISIBILITY & PRODUCT ACTIVE STATUS SYNCHRONIZER
 * 
 * Scans all registered Nurseries and NurseryProfiles in MongoDB,
 * resolves the authoritative active/approved whitelist, and synchronizes
 * `isNurseryActive` across ALL products in the database.
 * 
 * Rules:
 * 1. A nursery is active ONLY IF:
 *    - Linked User: role === "nursery", isActive === true, isBlocked !== true, status === "Active"
 *    - NurseryProfile: approvalStatus === "Approved", isActive === true, isBlocked !== true
 * 2. Any product whose nursery (or nurseryId / vendor) matches an active nursery identity
 *    is set to `isNurseryActive: true`.
 * 3. All other products (belonging to suspended, unapproved, blocked nurseries, or missing nursery)
 *    are set to `isNurseryActive: false`.
 * 4. Clears all Redis, L1 LRU, geospatial, and catalog caches.
 */
export async function syncAllProductsNurseryActiveStatus(): Promise<SyncResult> {
  const startTime = Date.now();
  console.log("🔄 [BackfillSync] Starting platform-wide nursery product visibility synchronization...");

  if (mongoose.connection.readyState !== 1) {
    console.warn("⚠️ [BackfillSync] MongoDB is not connected (readyState !== 1). Skipping synchronization.");
    return {
      success: false,
      activeNurseriesCount: 0,
      activeProductsUpdated: 0,
      suspendedProductsUpdated: 0,
      totalProductsCount: 0,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    // 1. Invalidate active nurseries cache first so getActiveNurseryIds retrieves fresh DB state
    await invalidateNurseryCache();

    // 2. Fetch active nursery IDs using the authoritative positive whitelist
    const activeNurseryIdStrings = await getActiveNurseryIds();
    const activeNurseriesCount = activeNurseryIdStrings.length;

    // Build mixed ObjectId and string list for defensive legacy matching
    const activeObjectIds: Types.ObjectId[] = [];
    for (const idStr of activeNurseryIdStrings) {
      if (mongoose.Types.ObjectId.isValid(idStr)) {
        activeObjectIds.push(new Types.ObjectId(idStr));
      }
    }

    const allActiveQueryIds = [...activeNurseryIdStrings, ...activeObjectIds];

    let activeProductsUpdated = 0;
    let suspendedProductsUpdated = 0;
    const totalProductsCount = await Product.countDocuments();

    if (allActiveQueryIds.length > 0) {
      // 3. Mark all products belonging to active nurseries as isNurseryActive: true
      const activeMatchFilter = {
        $or: [
          { nursery: { $in: allActiveQueryIds } },
          { nurseryId: { $in: allActiveQueryIds } },
          { vendor: { $in: allActiveQueryIds } },
        ],
      };

      const activeUpdate = await Product.updateMany(activeMatchFilter, {
        $set: { isNurseryActive: true },
      });
      activeProductsUpdated = activeUpdate.modifiedCount;

      // 4. Mark all other products as isNurseryActive: false
      const inactiveMatchFilter = {
        $nor: [
          { nursery: { $in: allActiveQueryIds } },
          { nurseryId: { $in: allActiveQueryIds } },
          { vendor: { $in: allActiveQueryIds } },
        ],
      };

      const inactiveUpdate = await Product.updateMany(inactiveMatchFilter, {
        $set: { isNurseryActive: false },
      });
      suspendedProductsUpdated = inactiveUpdate.modifiedCount;
    } else {
      // If there are zero active nurseries, all products must be isNurseryActive: false
      const allInactiveUpdate = await Product.updateMany({}, {
        $set: { isNurseryActive: false },
      });
      suspendedProductsUpdated = allInactiveUpdate.modifiedCount;
    }

    // 5. Invalidate all catalog, product, and geospatial caches again
    await invalidateNurseryCache();

    const duration = Date.now() - startTime;
    console.log(
      `✅ [BackfillSync] Synchronization completed in ${duration}ms:\n` +
      `   • Active Nurseries identified: ${activeNurseriesCount}\n` +
      `   • Active Products set to isNurseryActive=true: ${activeProductsUpdated}\n` +
      `   • Suspended/Inactive Products set to isNurseryActive=false: ${suspendedProductsUpdated}\n` +
      `   • Total Products in database: ${totalProductsCount}`
    );

    return {
      success: true,
      activeNurseriesCount,
      activeProductsUpdated,
      suspendedProductsUpdated,
      totalProductsCount,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error("❌ [BackfillSync] Platform-wide product visibility synchronization failed:", error);
    return {
      success: false,
      activeNurseriesCount: 0,
      activeProductsUpdated: 0,
      suspendedProductsUpdated: 0,
      totalProductsCount: 0,
      timestamp: new Date().toISOString(),
    };
  }
}
