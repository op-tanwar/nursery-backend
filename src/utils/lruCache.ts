/**
 * High-Speed Bounded In-Memory LRU (Least Recently Used) Cache
 *
 * Designed for microsecond-latency L1 caching of geo-distance and serviceability queries.
 * - O(1) reads, writes, and evictions using modern V8 Map key-order semantics.
 * - Strictly bounded size (default: 50,000 entries) preventing Node.js Out-Of-Memory (OOM).
 * - Per-entry or global Time-To-Live (TTL) with lazy and on-demand eviction.
 * - Zero external dependencies, thread-safe within the Node.js event loop.
 */

export interface LruCacheOptions {
  /** Maximum number of entries retained before LRU eviction. Defaults to 50,000. */
  max?: number;
  /** Default entry Time-To-Live in milliseconds. Defaults to 24 hours (86,400,000 ms). */
  ttl?: number;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class LruCache<K = string, V = any> {
  private readonly max: number;
  private readonly defaultTtl: number;
  private readonly cache: Map<K, CacheEntry<V>>;

  constructor(options: LruCacheOptions = {}) {
    this.max = options.max && options.max > 0 ? Math.floor(options.max) : 50000;
    this.defaultTtl =
      options.ttl && options.ttl > 0 ? options.ttl : 24 * 60 * 60 * 1000;
    this.cache = new Map<K, CacheEntry<V>>();
  }

  /**
   * Retrieves a value from the cache.
   * If expired, removes the entry and returns undefined.
   * On hit, refreshes LRU priority (moves entry to most-recently-used tail).
   */
  public get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    const now = Date.now();
    if (entry.expiresAt <= now) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh LRU order: delete and re-set to make it the most recently used
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  /**
   * Inserts or updates an entry in the cache.
   * Evicts the least-recently-used item if capacity exceeds `max`.
   */
  public set(key: K, value: V, ttlMs?: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest entry if at capacity
    while (this.cache.size >= this.max) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }

    const effectiveTtl =
      ttlMs !== undefined && ttlMs > 0 ? ttlMs : this.defaultTtl;

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + effectiveTtl,
    });
  }

  /**
   * Checks whether a non-expired entry exists in the cache.
   */
  public has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Removes a specific key from the cache.
   */
  public delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Completely clears the cache.
   */
  public clear(): void {
    this.cache.clear();
  }

  /**
   * Returns current count of entries in the cache.
   */
  public get size(): number {
    return this.cache.size;
  }

  /**
   * Returns configured maximum capacity.
   */
  public get maxSize(): number {
    return this.max;
  }

  /**
   * Returns default TTL in milliseconds.
   */
  public get ttl(): number {
    return this.defaultTtl;
  }

  /**
   * Scans and prunes all expired entries.
   * Returns the count of purged entries.
   */
  public prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
}
