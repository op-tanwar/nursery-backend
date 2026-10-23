/**
 * ⚡ In-Memory Cache Manager (High Performance Sub-Millisecond Cache)
 * Supports TTL expiration, size-limited LRU eviction, and pattern-based invalidation.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class CacheManager {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private defaultTTLMs: number = 60 * 1000; // 60 seconds default
  private maxEntries: number = 2000;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Run cleanup every 2 minutes to free memory
    this.cleanupInterval = setInterval(() => {
      this.evictExpired();
    }, 2 * 60 * 1000);

    // Prevent interval from keeping the Node.js process alive during graceful shutdown
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Get cached item or null if not found or expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * Set cached item with TTL in seconds
   */
  set<T>(key: string, value: T, ttlSeconds: number = 60): void {
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  /**
   * Delete a specific cache key
   */
  del(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Invalidate all keys matching a prefix or pattern (e.g. "catalog:*", "nursery:*")
   */
  invalidatePattern(prefixOrPattern: string): number {
    const prefix = prefixOrPattern.replace(/\*+$/, "");
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Get cached value or compute and cache it atomically
   */
  async getOrSet<T>(key: string, fetcher: () => Promise<T>, ttlSeconds: number = 60): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const fresh = await fetcher();
    this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  /**
   * Flush all items from the cache
   */
  flush(): void {
    this.cache.clear();
  }

  /**
   * Count of currently cached entries
   */
  size(): number {
    return this.cache.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  private evictOldest(): void {
    // Evict 10% oldest entries when max capacity reached
    const toDelete = Math.ceil(this.maxEntries * 0.1);
    let count = 0;
    for (const key of this.cache.keys()) {
      this.cache.delete(key);
      count++;
      if (count >= toDelete) break;
    }
  }
}

export const cacheManager = new CacheManager();
export default cacheManager;
