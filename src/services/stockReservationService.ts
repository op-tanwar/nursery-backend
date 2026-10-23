import mongoose, { Types } from "mongoose";
import StockReservation, {
  IStockReservation,
  IStockReservationItem,
} from "../models/stockReservationModel";
import { getCaseInsensitiveModel } from "../utils/productRegistry";

export interface ReservationLockItem {
  productId: Types.ObjectId | string;
  itemModel: string;
  quantity: number;
  name?: string;
  price?: number;
}

export interface ReserveStockResult {
  success: boolean;
  lockedItems: ReservationLockItem[];
  failedItem?: {
    productId: Types.ObjectId | string;
    itemModel: string;
    quantity: number;
    reason: string;
  };
}

/**
 * 🔒 Atomically reserve stock for an array of items with immediate rollback on any partial failure.
 * Ensures availableStock = (stock - reservedStock) >= quantity for each item.
 */
export const reserveStockForItems = async (
  items: ReservationLockItem[],
  session?: mongoose.ClientSession
): Promise<ReserveStockResult> => {
  const lockedItems: ReservationLockItem[] = [];

  for (const item of items) {
    const TargetModel = getCaseInsensitiveModel(item.itemModel);
    if (!TargetModel) {
      // Unknown model — rollback all previously locked items
      await rollbackLockedItems(lockedItems, session);
      return {
        success: false,
        lockedItems: [],
        failedItem: {
          productId: item.productId,
          itemModel: item.itemModel,
          quantity: item.quantity,
          reason: `Unknown product model: ${item.itemModel}`,
        },
      };
    }

    const productId = new mongoose.Types.ObjectId(item.productId);
    const quantity = Math.max(1, Number(item.quantity));

    // 🔒 Atomic conditional update: only increment reservedStock if availableStock >= quantity
    const updated = await TargetModel.findOneAndUpdate(
      {
        _id: productId,
        isActive: true,
        $expr: {
          $gte: [
            {
              $subtract: [
                { $ifNull: ["$stock", 0] },
                { $ifNull: ["$reservedStock", 0] },
              ],
            },
            quantity,
          ],
        },
      },
      {
        $inc: { reservedStock: quantity },
      },
      {
        new: true,
        ...(session ? { session } : {}),
      }
    );

    if (!updated) {
      // Stock allocation failed for this item — rollback all previous locks
      console.warn(
        `⚠️ [StockReservation] Insufficient stock or inactive product for ${item.itemModel} (${item.productId}). Quantity requested: ${quantity}. Rolling back locks...`
      );
      await rollbackLockedItems(lockedItems, session);
      return {
        success: false,
        lockedItems: [],
        failedItem: {
          productId: item.productId,
          itemModel: item.itemModel,
          quantity,
          reason: `Insufficient available stock for ${item.name || item.itemModel}`,
        },
      };
    }

    lockedItems.push({
      productId,
      itemModel: item.itemModel,
      quantity,
      name: item.name || updated.name,
      price: item.price ?? updated.price,
    });
  }

  return {
    success: true,
    lockedItems,
  };
};

/**
 * 🔄 Rollback locked items by decrementing reservedStock
 */
export const rollbackLockedItems = async (
  items: ReservationLockItem[],
  session?: mongoose.ClientSession
): Promise<void> => {
  for (const item of items) {
    try {
      const TargetModel = getCaseInsensitiveModel(item.itemModel);
      if (TargetModel) {
        await TargetModel.findByIdAndUpdate(
          item.productId,
          { $inc: { reservedStock: -Math.max(1, Number(item.quantity)) } },
          session ? { session } : {}
        );
      }
    } catch (err) {
      console.error(
        `🚨 [StockReservation] Rollback error for ${item.itemModel} (${item.productId}):`,
        err
      );
    }
  }
};

/**
 * 📝 Create a pending StockReservation record in MongoDB (default 15 minutes TTL)
 */
export const createStockReservationRecord = async (
  razorpayOrderId: string,
  userId: Types.ObjectId | string,
  items: ReservationLockItem[],
  ttlMinutes = 15,
  session?: mongoose.ClientSession
): Promise<IStockReservation> => {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const reservation = new StockReservation({
    razorpayOrderId,
    userId: new mongoose.Types.ObjectId(userId),
    items: items.map((it) => ({
      productId: new mongoose.Types.ObjectId(it.productId),
      itemModel: it.itemModel,
      quantity: Math.max(1, Number(it.quantity)),
      name: it.name,
      price: it.price,
    })),
    status: "PENDING",
    expiresAt,
  });

  await reservation.save(session ? { session } : {});
  return reservation;
};

/**
 * 🎯 Commit a pending stock reservation into permanent stock deduction:
 *   stock: -quantity
 *   reservedStock: -quantity
 * Idempotent: returns alreadyCommitted if called multiple times.
 */
export const commitStockReservation = async (
  razorpayOrderId: string,
  session?: mongoose.ClientSession
): Promise<{
  success: boolean;
  status: "COMMITTED" | "ALREADY_COMMITTED" | "EXPIRED_OR_RELEASED" | "NOT_FOUND";
  reservation?: IStockReservation | null;
}> => {
  const reservation = await StockReservation.findOne({
    razorpayOrderId,
  }).session(session || null);

  if (!reservation) {
    return { success: false, status: "NOT_FOUND" };
  }

  if (reservation.status === "COMMITTED") {
    return { success: true, status: "ALREADY_COMMITTED", reservation };
  }

  if (reservation.status === "RELEASED") {
    return { success: false, status: "EXPIRED_OR_RELEASED", reservation };
  }

  // Pending reservation found — commit stock deduction
  for (const item of reservation.items) {
    const TargetModel = getCaseInsensitiveModel(item.itemModel);
    if (TargetModel) {
      await TargetModel.findByIdAndUpdate(
        item.productId,
        {
          $inc: {
            stock: -Number(item.quantity),
            reservedStock: -Number(item.quantity),
          },
        },
        session ? { session } : {}
      );
    }
  }

  reservation.status = "COMMITTED";
  reservation.committedAt = new Date();
  await reservation.save(session ? { session } : {});

  return { success: true, status: "COMMITTED", reservation };
};

/**
 * 🔓 Release a pending reservation (e.g. checkout cancelled or TTL expired):
 *   reservedStock: -quantity
 */
export const releaseStockReservation = async (
  razorpayOrderId: string,
  reason: string,
  session?: mongoose.ClientSession
): Promise<{
  success: boolean;
  reason?: string;
  reservation?: IStockReservation | null;
}> => {
  const reservation = await StockReservation.findOne({
    razorpayOrderId,
    status: "PENDING",
  }).session(session || null);

  if (!reservation) {
    return { success: false, reason: "NOT_FOUND_OR_NOT_PENDING" };
  }

  for (const item of reservation.items) {
    const TargetModel = getCaseInsensitiveModel(item.itemModel);
    if (TargetModel) {
      await TargetModel.findByIdAndUpdate(
        item.productId,
        {
          $inc: { reservedStock: -Number(item.quantity) },
        },
        session ? { session } : {}
      );
    }
  }

  reservation.status = "RELEASED";
  reservation.releasedAt = new Date();
  reservation.releaseReason = reason;
  await reservation.save(session ? { session } : {});

  return { success: true, reservation };
};

/**
 * 🧹 Sweep expired pending reservations and restore reservedStock to inventory
 */
export const sweepExpiredReservations = async (): Promise<number> => {
  const now = new Date();
  const expiredList = await StockReservation.find({
    status: "PENDING",
    expiresAt: { $lte: now },
  }).limit(50);

  if (expiredList.length === 0) return 0;

  let releasedCount = 0;
  for (const res of expiredList) {
    try {
      const result = await releaseStockReservation(
        res.razorpayOrderId,
        "TTL_EXPIRED"
      );
      if (result.success) {
        releasedCount++;
        console.log(
          `⏱️ [StockReservation] Released expired reservation for Razorpay Order: ${res.razorpayOrderId}`
        );
      }
    } catch (err) {
      console.error(
        `🚨 [StockReservation] Failed to release expired reservation ${res.razorpayOrderId}:`,
        err
      );
    }
  }

  return releasedCount;
};

// Worker interval state
let sweeperInterval: NodeJS.Timeout | null = null;
let isSweeping = false;

/**
 * 🚀 Start background worker to periodically sweep expired reservations
 */
export const startStockReservationWorker = (intervalMs = 60000): void => {
  if (sweeperInterval) {
    console.log("ℹ️ [StockReservationWorker] Sweeper already running.");
    return;
  }

  console.log(
    `🚀 [StockReservationWorker] Starting sweeper background worker (Interval: ${intervalMs}ms)...`
  );

  sweeperInterval = setInterval(async () => {
    if (isSweeping) return;
    isSweeping = true;
    try {
      const count = await sweepExpiredReservations();
      if (count > 0) {
        console.log(
          `🧹 [StockReservationWorker] Swept ${count} expired reservation(s).`
        );
      }
    } catch (error) {
      console.error(
        "🚨 [StockReservationWorker] Unhandled error during sweep:",
        error
      );
    } finally {
      isSweeping = false;
    }
  }, intervalMs);
};

/**
 * 🛑 Stop background worker cleanly
 */
export const stopStockReservationWorker = (): void => {
  if (sweeperInterval) {
    clearInterval(sweeperInterval);
    sweeperInterval = null;
    console.log("🛑 [StockReservationWorker] Sweeper worker stopped.");
  }
};
