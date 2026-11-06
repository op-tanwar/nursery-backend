import mongoose, { Types } from "mongoose";
import StockReservation, {
  IStockReservation,
  IStockReservationItem,
} from "../models/stockReservationModel";
import Product from "../models/productModel";
import { getCaseInsensitiveModel } from "../utils/productRegistry";
import {
  acquireLock,
  releaseLock,
  withLock,
  getRedisClient,
  getRedisSubscriber,
  isRedisReady,
} from "../config/redis";

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
 * Uses distributed locking per product to prevent concurrent double-booking of stock across containers.
 * Ensures availableStock = (stock - reservedStock) >= quantity for each item.
 */
export const reserveStockForItems = async (
  items: ReservationLockItem[],
  session?: mongoose.ClientSession
): Promise<ReserveStockResult> => {
  const lockedItems: ReservationLockItem[] = [];

  for (const item of items) {
    const productId = new mongoose.Types.ObjectId(item.productId);
    const quantity = Math.max(1, Number(item.quantity));

    // 🔒 Acquire distributed lock for this product to prevent concurrent double-booking across instances
    const lockResource = `product_stock:${productId.toString()}`;
    let lockToken: string | null = null;
    try {
      lockToken = await acquireLock(lockResource, 5000);
    } catch (_) {}

    try {
      // Atomic conditional update: only increment reservedStock if availableStock >= quantity
      const updated = await Product.findOneAndUpdate(
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
    } finally {
      if (lockToken) {
        await releaseLock(lockResource, lockToken).catch(() => {});
      }
    }
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
      await Product.findByIdAndUpdate(
        item.productId,
        { $inc: { reservedStock: -Math.max(1, Number(item.quantity)) } },
        session ? { session } : {}
      );
    } catch (err) {
      console.error(
        `🚨 [StockReservation] Rollback error for ${item.itemModel} (${item.productId}):`,
        err
      );
    }
  }
};

/**
 * 📝 Create a pending StockReservation record in MongoDB & Redis (default 15 minutes TTL)
 */
export const createStockReservationRecord = async (
  razorpayOrderId: string,
  userId: Types.ObjectId | string,
  items: ReservationLockItem[],
  ttlMinutes = 15,
  session?: mongoose.ClientSession,
  shippingInfo?: any
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
    shippingInfo: shippingInfo || null,
    status: "PENDING",
    expiresAt,
  });

  await reservation.save(session ? { session } : {});

  // ⚡ Synchronize temporary reservation hold to Redis with native TTL & ZSET index
  if (isRedisReady()) {
    const client = getRedisClient();
    if (client) {
      try {
        const ttlSeconds = Math.max(60, ttlMinutes * 60);
        const pipeline = client.pipeline();

        // 1. Order-level reservation key with auto-expiry
        const holdPayload = JSON.stringify({
          razorpayOrderId,
          userId: String(userId),
          items,
          expiresAt: expiresAt.getTime(),
        });
        pipeline.set(`stock_hold:order:${razorpayOrderId}`, holdPayload, "EX", ttlSeconds);

        // 2. Product-level hold keys for instant cross-container stock checks
        for (const it of items) {
          pipeline.set(
            `stock_hold:item:${String(it.productId)}:${razorpayOrderId}`,
            String(it.quantity),
            "EX",
            ttlSeconds
          );
        }

        // 3. Add to Redis Sorted Set for distributed timestamp-based expiration sweeping
        pipeline.zadd("stock_reservations:expiring", expiresAt.getTime(), razorpayOrderId);

        await pipeline.exec();
      } catch (err: any) {
        console.warn("⚠️ [StockReservation] Error syncing hold to Redis:", err.message);
      }
    }
  }

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
  // 🔒 ATOMIC STATUS GUARD: Exactly one execution transitions PENDING -> COMMITTED
  const reservation = await StockReservation.findOneAndUpdate(
    {
      razorpayOrderId,
      status: "PENDING",
    },
    {
      $set: {
        status: "COMMITTED",
        committedAt: new Date(),
      },
    },
    {
      new: false,
      ...(session ? { session } : {}),
    }
  );

  if (!reservation) {
    const existing = await StockReservation.findOne({
      razorpayOrderId,
    }).session(session || null);

    if (!existing) {
      return { success: false, status: "NOT_FOUND" };
    }

    if (existing.status === "COMMITTED") {
      return { success: true, status: "ALREADY_COMMITTED", reservation: existing };
    }

    return { success: false, status: "EXPIRED_OR_RELEASED", reservation: existing };
  }

  // Pending reservation won the atomic race — commit permanent stock deduction
  for (const item of reservation.items) {
    await Product.findByIdAndUpdate(
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

  // ⚡ Remove Redis hold keys and ZSET tracking
  if (isRedisReady()) {
    const client = getRedisClient();
    if (client) {
      try {
        const pipeline = client.pipeline();
        pipeline.del(`stock_hold:order:${razorpayOrderId}`);
        for (const item of reservation.items) {
          pipeline.del(`stock_hold:item:${String(item.productId)}:${razorpayOrderId}`);
        }
        pipeline.zrem("stock_reservations:expiring", razorpayOrderId);
        await pipeline.exec();
      } catch (err: any) {
        console.warn("⚠️ [StockReservation] Error clearing Redis hold on commit:", err.message);
      }
    }
  }

  return { success: true, status: "COMMITTED", reservation };
};

/**
 * 🔓 Release a pending reservation (e.g. checkout cancelled or TTL expired):
 *   reservedStock: -quantity
 * Strictly idempotent: MongoDB atomic findOneAndUpdate prevents concurrent double release.
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
  // 🔒 ATOMIC STATUS GUARD: Exactly one execution transitions PENDING -> RELEASED
  const reservation = await StockReservation.findOneAndUpdate(
    {
      razorpayOrderId,
      status: "PENDING",
    },
    {
      $set: {
        status: "RELEASED",
        releasedAt: new Date(),
        releaseReason: reason,
      },
    },
    {
      new: false, // returns previous document state containing items to restore
      ...(session ? { session } : {}),
    }
  );

  // ⚡ Defensively clear Redis hold keys and ZSET tracking regardless of status
  if (isRedisReady()) {
    const client = getRedisClient();
    if (client) {
      try {
        const pipeline = client.pipeline();
        pipeline.del(`stock_hold:order:${razorpayOrderId}`);
        if (reservation?.items) {
          for (const item of reservation.items) {
            pipeline.del(`stock_hold:item:${String(item.productId)}:${razorpayOrderId}`);
          }
        }
        pipeline.zrem("stock_reservations:expiring", razorpayOrderId);
        await pipeline.exec();
      } catch (err: any) {
        console.warn("⚠️ [StockReservation] Error clearing Redis hold on release:", err.message);
      }
    }
  }

  if (!reservation) {
    return { success: false, reason: "NOT_FOUND_OR_NOT_PENDING" };
  }

  // Restore available stock by decrementing reservedStock
  for (const item of reservation.items) {
    await Product.findByIdAndUpdate(
      item.productId,
      {
        $inc: { reservedStock: -Number(item.quantity) },
      },
      session ? { session } : {}
    );
  }

  return { success: true, reservation };
};

/**
 * 🧹 Sweep expired pending reservations across all distributed instances.
 * Uses a distributed lock (Redlock pattern) so only ONE instance runs the sweep at any given time.
 */
export const sweepExpiredReservationsDistributed = async (): Promise<number> => {
  // Acquire distributed lock for sweeper (valid for 50s) to prevent concurrent sweeps across nodes
  const lockToken = await acquireLock("worker:stock_reservation_sweeper", 50000);
  if (!lockToken) {
    // Another node is currently sweeping
    return 0;
  }

  let totalReleased = 0;
  try {
    const nowMs = Date.now();
    const nowDate = new Date(nowMs);

    // 1. Check Redis Sorted Set for reservations whose expiration timestamp <= now
    if (isRedisReady()) {
      const client = getRedisClient();
      if (client) {
        try {
          const expiredOrderIds = await client.zrangebyscore(
            "stock_reservations:expiring",
            "-inf",
            nowMs,
            "LIMIT",
            0,
            50
          );

          if (expiredOrderIds && expiredOrderIds.length > 0) {
            for (const orderId of expiredOrderIds) {
              try {
                // Remove from ZSET immediately to prevent duplicate sweep attempts across cycles
                await client.zrem("stock_reservations:expiring", orderId);
                const res = await releaseStockReservation(orderId, "TTL_EXPIRED");
                if (res.success) {
                  totalReleased++;
                  console.log(`⏱️ [DistributedSweeper] Released expired reservation for Order: ${orderId}`);
                }
              } catch (err) {
                console.error(`🚨 [DistributedSweeper] Error releasing expired order ${orderId}:`, err);
              }
            }
          }
        } catch (err: any) {
          console.warn("⚠️ [DistributedSweeper] Redis ZSET query error:", err.message);
        }
      }
    }

    // 2. Safety reconciliation against MongoDB for any expired PENDING records
    // (catches any records created during Redis downtime or missed events)
    const expiredMongo = await StockReservation.find({
      status: "PENDING",
      expiresAt: { $lte: nowDate },
    }).limit(50);

    for (const res of expiredMongo) {
      try {
        const result = await releaseStockReservation(res.razorpayOrderId, "TTL_EXPIRED");
        if (result.success) {
          totalReleased++;
          console.log(`⏱️ [DistributedSweeper] Reconciled expired MongoDB reservation: ${res.razorpayOrderId}`);
        }
      } catch (err) {
        console.error(`🚨 [DistributedSweeper] Reconciliation error for ${res.razorpayOrderId}:`, err);
      }
    }
  } finally {
    await releaseLock("worker:stock_reservation_sweeper", lockToken).catch(() => {});
  }

  return totalReleased;
};

// ======================================================================
// 📡 4. REDIS KEYSPACE NOTIFICATION SUBSCRIBER (REAL-TIME EXPIRATION)
// ======================================================================

let keyspaceSubscribed = false;

export const initKeyspaceSubscriber = async (): Promise<void> => {
  if (keyspaceSubscribed || !isRedisReady()) return;

  const subscriber = getRedisSubscriber();
  if (!subscriber) return;

  try {
    const client = getRedisClient();
    if (client) {
      // 🛡️ CLOUD-MANAGED REDIS GUARD (Upstash / AWS ElastiCache / Azure / GCP Memorystore):
      // The CONFIG command is strictly blocked or restricted with NOPERM / unknown command on managed tiers.
      // Probing is defensively wrapped to prevent unhandled rejections during server startup.
      try {
        await client.config("SET", "notify-keyspace-events", "Ex");
        console.log("📡 [StockReservation] Redis keyspace events configured (notify-keyspace-events=Ex).");
      } catch (configErr: any) {
        const errMsg = configErr?.message || String(configErr);
        if (
          errMsg.includes("unknown command") ||
          errMsg.includes("NOPERM") ||
          errMsg.includes("permission denied") ||
          errMsg.includes("ERR unknown command 'CONFIG'")
        ) {
          console.warn(
            "⚠️ [StockReservation] CONFIG command is disabled on managed Redis. Falling back to active sweep/dashboard pre-configuration."
          );
        } else {
          console.warn(
            `⚠️ [StockReservation] Notice: CONFIG SET notify-keyspace-events bypassed (${errMsg}). Falling back to active sweeper.`
          );
        }
      }
    }

    await subscriber.psubscribe("__keyevent@*__:expired");
    keyspaceSubscribed = true;

    subscriber.on("pmessage", async (_pattern, _channel, message) => {
      // message is the expired key name, e.g. "stock_hold:order:order_xyz"
      if (typeof message === "string" && message.startsWith("stock_hold:order:")) {
        const razorpayOrderId = message.replace("stock_hold:order:", "");
        // Use per-order lock so only one node releases this specific expired order
        const orderLock = await acquireLock(`lock:expire:${razorpayOrderId}`, 15000);
        if (orderLock) {
          try {
            await releaseStockReservation(razorpayOrderId, "TTL_EXPIRED");
            console.log(`⚡ [KeyspaceEvent] Real-time restoration for expired reservation: ${razorpayOrderId}`);
          } catch (err) {
            console.error(`🚨 [KeyspaceEvent] Failed to release expired reservation ${razorpayOrderId}:`, err);
          } finally {
            await releaseLock(`lock:expire:${razorpayOrderId}`, orderLock).catch(() => {});
          }
        }
      }
    });

    console.log("📡 [StockReservation] Redis keyspace expiration listener registered.");
  } catch (err: any) {
    console.warn("⚠️ [StockReservation] Keyspace subscription not available:", err.message || err);
  }
};

// ======================================================================
// 🚀 5. DISTRIBUTED WORKER LIFECYCLE
// ======================================================================

let sweeperInterval: NodeJS.Timeout | null = null;
let isSweeping = false;

export const initDistributedStockReservation = async (intervalMs = 60000): Promise<void> => {
  // 1. Initialize keyspace notification listener for real-time expiry (guarded against CONFIG failures)
  await initKeyspaceSubscriber();

  // 2. Immediate startup sweep to catch any reservations expired during server restarts
  sweepExpiredReservationsDistributed().catch((err) => {
    console.warn("⚠️ [StockReservation] Initial startup sweep notice:", err.message || err);
  });

  // 3. Start distributed sweeper runner (synchronized via distributed lock)
  if (sweeperInterval) return;

  sweeperInterval = setInterval(async () => {
    if (isSweeping) return;
    isSweeping = true;
    try {
      const count = await sweepExpiredReservationsDistributed();
      if (count > 0) {
        console.log(`🧹 [DistributedSweeper] Swept ${count} expired reservation(s).`);
      }
    } catch (err) {
      console.error("🚨 [DistributedSweeper] Unhandled sweeper error:", err);
    } finally {
      isSweeping = false;
    }
  }, intervalMs);

  if (sweeperInterval.unref) {
    sweeperInterval.unref();
  }
};

export const shutdownDistributedStockReservation = (): void => {
  if (sweeperInterval) {
    clearInterval(sweeperInterval);
    sweeperInterval = null;
  }
  keyspaceSubscribed = false;
  console.log("🛑 [StockReservation] Distributed reservation worker stopped cleanly.");
};

// Export backward-compatible aliases
export const startStockReservationWorker = initDistributedStockReservation;
export const stopStockReservationWorker = shutdownDistributedStockReservation;
export const sweepExpiredReservations = sweepExpiredReservationsDistributed;
