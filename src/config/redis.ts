import Redis, { RedisOptions } from "ioredis";
import crypto from "node:crypto";

// ======================================================================
// ⚙️ 1. REDIS CLIENT CONFIGURATION & FACTORY
// ======================================================================

let redisClient: Redis | null = null;
let redisSubscriber: Redis | null = null;
let isReady = false;

// In-memory fallback map for distributed locks if Redis is unreachable
const inMemoryLocks = new Map<string, { token: string; expiresAt: number }>();

const getRedisOptions = (): RedisOptions => {
  const options: RedisOptions = {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 3,
    connectTimeout: 10000,
    keepAlive: 30000,
    retryStrategy: (times: number) => {
      if (times > 10) {
        console.warn(`⚠️ [Redis] High reconnect retry count (${times}). Throttling retry interval.`);
        return Math.min(times * 500, 10000);
      }
      return Math.min(times * 150 + Math.floor(Math.random() * 100), 3000);
    },
  };

  // Support TLS (e.g. rediss:// on AWS ElastiCache / Render / Upstash)
  if (process.env.REDIS_TLS === "true") {
    options.tls = {};
  }

  if (process.env.REDIS_PASSWORD) {
    options.password = process.env.REDIS_PASSWORD;
  }

  if (process.env.REDIS_USERNAME) {
    options.username = process.env.REDIS_USERNAME;
  }

  if (process.env.REDIS_DB) {
    options.db = Number(process.env.REDIS_DB) || 0;
  }

  return options;
};

export const createRedisInstance = (): Redis => {
  const options = getRedisOptions();
  const redisUrl = process.env.REDIS_URL;

  let client: Redis;
  if (redisUrl) {
    client = new Redis(redisUrl, options);
  } else {
    client = new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: Number(process.env.REDIS_PORT) || 6379,
      ...options,
    });
  }

  return client;
};

// ======================================================================
// 🚀 2. LIFECYCLE MANAGEMENT & EVENT REGISTRATION
// ======================================================================

export const initRedis = async (): Promise<boolean> => {
  try {
    if (redisClient && isReady) {
      return true;
    }

    redisClient = createRedisInstance();

    redisClient.on("connect", () => {
      console.log("🔌 [Redis] Socket connected successfully.");
    });

    redisClient.on("ready", () => {
      isReady = true;
      console.log("✅ [Redis] Connection ready and operational.");
    });

    redisClient.on("error", (err) => {
      isReady = false;
      console.warn("⚠️ [Redis] Client error (operating in fallback mode):", err.message);
    });

    redisClient.on("close", () => {
      isReady = false;
      console.log("🔒 [Redis] Socket connection closed.");
    });

    redisClient.on("reconnecting", (time: number) => {
      console.log(`🔄 [Redis] Reconnecting in ${time}ms...`);
    });

    await redisClient.connect();
    return true;
  } catch (err: any) {
    isReady = false;
    console.warn(
      `⚠️ [Redis] Could not establish connection (${err?.message || err}). Falling back to in-memory mode.`
    );
    return false;
  }
};

export const disconnectRedis = async (): Promise<void> => {
  isReady = false;

  const tasks: Promise<any>[] = [];
  if (redisSubscriber) {
    tasks.push(
      redisSubscriber.quit().catch(() => {
        try {
          redisSubscriber?.disconnect();
        } catch (_) {}
      })
    );
    redisSubscriber = null;
  }

  if (redisClient) {
    tasks.push(
      redisClient.quit().catch(() => {
        try {
          redisClient?.disconnect();
        } catch (_) {}
      })
    );
    redisClient = null;
  }

  await Promise.all(tasks);
};

export const isRedisReady = (): boolean => isReady && redisClient !== null && redisClient.status === "ready";

export const getRedisClient = (): Redis | null => redisClient;

export const getRedisSubscriber = (): Redis | null => {
  if (!redisSubscriber && isRedisReady()) {
    try {
      redisSubscriber = createRedisInstance();
      redisSubscriber.on("error", (err) => {
        console.warn("⚠️ [Redis Subscriber] Error:", err.message);
      });
      redisSubscriber.connect().catch(() => {});
    } catch (_) {}
  }
  return redisSubscriber;
};

// ======================================================================
// 🔒 3. DISTRIBUTED LOCK IMPLEMENTATION (Redlock Pattern)
// ======================================================================

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Acquire a distributed lock across all horizontal instances.
 * Uses atomic SET resource token PX ttlMs NX.
 *
 * @param resource Key identifier for resource to lock
 * @param ttlMs Time-to-live in milliseconds before lock automatically expires (default 10000ms)
 * @returns string token if lock acquired, or null if resource is currently locked by another worker
 */
export const acquireLock = async (
  resource: string,
  ttlMs = 10000
): Promise<string | null> => {
  const lockKey = `lock:${resource}`;
  const token = crypto.randomUUID();

  if (isRedisReady() && redisClient) {
    try {
      const result = await redisClient.set(lockKey, token, "PX", ttlMs, "NX");
      return result === "OK" ? token : null;
    } catch (err: any) {
      console.warn(`⚠️ [Redis Lock] Error acquiring lock on "${resource}":`, err.message);
    }
  }

  // In-memory fallback if Redis is down
  const now = Date.now();
  const existing = inMemoryLocks.get(lockKey);
  if (existing && existing.expiresAt > now) {
    return null;
  }

  inMemoryLocks.set(lockKey, { token, expiresAt: now + ttlMs });
  return token;
};

/**
 * Release a previously acquired distributed lock safely.
 * Only the owner who holds the matching token can release the lock (prevents deleting another instance's lock).
 */
export const releaseLock = async (
  resource: string,
  token: string
): Promise<boolean> => {
  const lockKey = `lock:${resource}`;

  if (isRedisReady() && redisClient) {
    try {
      const result = await redisClient.eval(RELEASE_LOCK_LUA, 1, lockKey, token);
      return result === 1;
    } catch (err: any) {
      console.warn(`⚠️ [Redis Lock] Error releasing lock on "${resource}":`, err.message);
    }
  }

  // In-memory fallback
  const existing = inMemoryLocks.get(lockKey);
  if (existing && existing.token === token) {
    inMemoryLocks.delete(lockKey);
    return true;
  }

  return false;
};

/**
 * Execute a critical asynchronous routine within a distributed lock boundary.
 */
export const withLock = async <T>(
  resource: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> => {
  const token = await acquireLock(resource, ttlMs);
  if (!token) {
    throw new Error(`[DistributedLock] Failed to acquire lock for resource "${resource}". Resource busy.`);
  }

  try {
    return await fn();
  } finally {
    await releaseLock(resource, token).catch((err) => {
      console.error(`🚨 [DistributedLock] Failed to release lock "${resource}":`, err);
    });
  }
};
