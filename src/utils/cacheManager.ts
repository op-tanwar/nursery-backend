/**
 * ⚡ Horizontally Scalable Distributed Cache Manager
 * Uses Redis (ioredis) as the primary storage engine with automatic fallback
 * to an in-memory LRU store during offline states or network interruptions.
 */

import { getRedisClient, isRedisReady } from "../config/redis";

interface MemoryCacheEntry<T> {
  value: T;
  expiresAt: number;
}

class CacheManager {
  private memoryCache: Map<string, MemoryCacheEntry<any>> = new Map();
  private maxMemoryEntries: number = 2000;
  private defaultTTLSeconds: number = 60;

  constructor() {
    // Background sweep for in-memory fallback store
    const interval = setInterval(() => {
      this.evictExpiredMemoryEntries();
    }, 2 * 60 * 1000);

    if (interval.unref) {
      interval.unref();
    }
  }

  /**
   * Safe serialization for Redis values
   */
  private serialize<T>(value: T): string {
    return JSON.stringify(value);
  }

  /**
   * Safe deserialization handling primitives, objects, arrays, and plain strings
   */
  private deserialize<T>(data: string | null): T | null {
    if (data === null || data === undefined) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return data as unknown as T;
    }
  }

  /**
   * Get cached item or null if not found or expired
   */
  async get<T>(key: string): Promise<T | null> {
    if (isRedisReady()) {
      const client = getRedisClient();
      if (client) {
        try {
          const raw = await client.get(key);
          if (raw !== null) {
            return this.deserialize<T>(raw);
          }
          return null;
        } catch (err: any) {
          console.warn(`⚠️ [CacheManager] Redis GET failed for key "${key}":`, err.message);
        }
      }
    }

    // Fallback: In-memory store
    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * Set cached item with TTL in seconds
   */
  async set<T>(key: string, value: T, ttlSeconds: number = this.defaultTTLSeconds): Promise<void> {
    const ttl = Math.max(1, ttlSeconds);

    if (isRedisReady()) {
      const client = getRedisClient();
      if (client) {
        try {
          const payload = this.serialize(value);
          await client.set(key, payload, "EX", ttl);
          return;
        } catch (err: any) {
          console.warn(`⚠️ [CacheManager] Redis SET failed for key "${key}":`, err.message);
        }
      }
    }

    // Fallback: In-memory store
    if (this.memoryCache.size >= this.maxMemoryEntries) {
      this.evictOldestMemoryEntries();
    }

    this.memoryCache.set(key, {
      value,
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  /**
   * Delete a specific cache key
   */
  async del(key: string): Promise<boolean> {
    let deleted = false;

    if (isRedisReady()) {
      const client = getRedisClient();
      if (client) {
        try {
          const res = await client.del(key);
          deleted = res > 0;
        } catch (err: any) {
          console.warn(`⚠️ [CacheManager] Redis DEL failed for key "${key}":`, err.message);
        }
      }
    }

    const memDeleted = this.memoryCache.delete(key);
    return deleted || memDeleted;
  }

  /**
   * Check if key exists in cache
   */
  async has(key: string): Promise<boolean> {
    if (isRedisReady()) {
      const client = getRedisClient();
      if (client) {
        try {
          const exists = await client.exists(key);
          return exists > 0;
        } catch (err: any) {
          console.warn(`⚠️ [CacheManager] Redis EXISTS failed for key "${key}":`, err.message);
        }
      }
    }

    const entry = this.memoryCache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.memoryCache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Invalidate all keys matching a prefix or pattern (e.g. "catalog:*", "nursery:*")
   * Uses non-blocking SCAN with batch deletion instead of blocking KEYS *.
   */
  async invalidatePattern(prefixOrPattern: string): Promise<number> {
    let totalDeleted = 0;
    const matchPattern = prefixOrPattern.endsWith("*") ? prefixOrPattern : `${prefixOrPattern}*`;

    if (isRedisReady()) {
      const client = getRedisClient();
      if (client) {
        try {
          let cursor = "0";
          do {
            const [nextCursor, keys] = await client.scan(cursor, "MATCH", matchPattern, "COUNT", 100);
            cursor = nextCursor;
            if (keys && keys.length > 0) {
              const count = await client.del(...keys);
              totalDeleted += count;
            }
          } while (cursor !== "0");
        } catch (err: any) {
          console.warn(`⚠️ [CacheManager] Redis SCAN invalidation error for "${matchPattern}":`, err.message);
        }
      }
    }

    // Invalidate matching keys from in-memory fallback
    const memDeleted = this.invalidateMemoryPattern(prefixOrPattern);
    return Math.max(totalDeleted, memDeleted);
  }

  /**
   * Get cached value or compute, cache, and return it
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number = this.defaultTTLSeconds
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const fresh = await fetcher();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  /**
   * Flush all keys from the cache
   */
  async flush(): Promise<void> {
    if (isRedisReady()) {
      const client = getRedisClient();
      if (client) {
        try {
          await client.flushdb();
        } catch (err: any) {
          console.warn("⚠️ [CacheManager] Redis FLUSHDB error:", err.message);
        }
      }
    }
    this.memoryCache.clear();
  }

  /**
   * Approximate size of cached entries
   */
  async size(): Promise<number> {
    if (isRedisReady()) {
      const client = getRedisClient();
      if (client) {
        try {
          return await client.dbsize();
        } catch (_) {}
      }
    }
    return this.memoryCache.size;
  }

  private invalidateMemoryPattern(prefixOrPattern: string): number {
    const prefix = prefixOrPattern.replace(/\*+$/, "");
    let count = 0;
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        this.memoryCache.delete(key);
        count++;
      }
    }
    return count;
  }

  private evictExpiredMemoryEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now > entry.expiresAt) {
        this.memoryCache.delete(key);
      }
    }
  }

  private evictOldestMemoryEntries(): void {
    const toDelete = Math.ceil(this.maxMemoryEntries * 0.1);
    let count = 0;
    for (const key of this.memoryCache.keys()) {
      this.memoryCache.delete(key);
      count++;
      if (count >= toDelete) break;
    }
  }
}

export const cacheManager = new CacheManager();
export default cacheManager;
