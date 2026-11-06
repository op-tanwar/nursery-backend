import { loadData } from "india-pincode";
import { LruCache } from "./lruCache";
import { getRedisClient, isRedisReady } from "../config/redis";
import NurseryProfile from "../models/nurseryProfileModel";

export interface NearbyPincode {
  pincode: string;
  distanceKm: number;
}

export type PincodeErrorCode = "INVALID_FORMAT" | "NOT_FOUND" | "NO_COORDINATES";

export class PincodeServiceError extends Error {
  public readonly code: PincodeErrorCode;

  constructor(message: string, code: PincodeErrorCode) {
    super(message);
    this.code = code;
    this.name = "PincodeServiceError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface PincodeCoordinate {
  pincode: string;
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;
const INDIA_LAT_MIN = 6;
const INDIA_LAT_MAX = 37.5;
const INDIA_LNG_MIN = 68;
const INDIA_LNG_MAX = 98;
/** Product target is ~10–12 km; default to 12 unless env overrides. */
const DEFAULT_SERVICE_RADIUS_KM = 12;

let pincodeIndexCache: PincodeCoordinate[] | null = null;
let pincodeLookupCache: Map<string, PincodeCoordinate> | null = null;

// ======================================================================
// ⚡ TWO-TIER CACHE INITIALIZATION (L1 IN-MEMORY LRU & L2 REDIS KEYS)
// ======================================================================

/**
 * L1 In-Memory LRU Cache: Bounded to 50,000 entries with 24-hour TTL.
 * Provides microsecond-latency O(1) hits without network I/O or event-loop blocking.
 */
export const l1DistanceCache = new LruCache<string, number>({
  max: 50000,
  ttl: 24 * 60 * 60 * 1000, // 24 hours
});

/**
 * L1 Cache for nearby pincode radial expansions (bounded to 10,000 centers, 24h TTL).
 */
export const l1NearbyPincodesCache = new LruCache<string, NearbyPincode[]>({
  max: 10000,
  ttl: 24 * 60 * 60 * 1000, // 24 hours
});

/**
 * L1 Cache for serviceable nursery IDs per customer pincode (bounded to 10,000 entries, 24h TTL).
 */
export const l1ServiceableNurseriesCache = new LruCache<string, string[]>({
  max: 10000,
  ttl: 24 * 60 * 60 * 1000, // 24 hours
});

/** Read radius lazily so dotenv has already run (import-time env is unreliable). */
export const getServiceRadiusKm = (): number => {
  const parsed = Number(process.env.NURSERY_SERVICE_RADIUS_KM);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_SERVICE_RADIUS_KM;
};

/** @deprecated Prefer getServiceRadiusKm() — kept for existing imports. */
export const NURSERY_SERVICE_RADIUS_KM = DEFAULT_SERVICE_RADIUS_KM;

const isInIndiaBounds = (lat: number, lng: number): boolean =>
  lat >= INDIA_LAT_MIN &&
  lat <= INDIA_LAT_MAX &&
  lng >= INDIA_LNG_MIN &&
  lng <= INDIA_LNG_MAX;

const normalizeCoordinates = (
  latitude: number | null | undefined,
  longitude: number | null | undefined
): { lat: number; lng: number } | null => {
  if (
    latitude == null ||
    longitude == null ||
    Number.isNaN(latitude) ||
    Number.isNaN(longitude)
  ) {
    return null;
  }

  if (isInIndiaBounds(latitude, longitude)) {
    return { lat: latitude, lng: longitude };
  }

  // Some source rows swap lat/lng
  if (isInIndiaBounds(longitude, latitude)) {
    return { lat: longitude, lng: latitude };
  }

  return null;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

/**
 * Mathematical Haversine formula calculation.
 * Computes great-circle distance between two latitude/longitude points in kilometers.
 */
export const calculateDistanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
};

/**
 * Build once: unique Indian PIN median lat/lng from offline post-office dataset.
 */
const ensurePincodeIndex = (): {
  index: PincodeCoordinate[];
  lookup: Map<string, PincodeCoordinate>;
} => {
  if (pincodeIndexCache && pincodeLookupCache) {
    return { index: pincodeIndexCache, lookup: pincodeLookupCache };
  }

  const offices = loadData();
  if (!Array.isArray(offices) || offices.length === 0) {
    throw new PincodeServiceError(
      "Unable to find location for this PIN code. Please verify the PIN code and try again.",
      "NO_COORDINATES"
    );
  }

  const coordsByPincode = new Map<string, { lat: number; lng: number }[]>();

  for (const office of offices) {
    const normalized = normalizeCoordinates(office.latitude, office.longitude);
    if (!normalized) continue;

    const pin = String(office.pincode).trim();
    if (!/^[1-9][0-9]{5}$/.test(pin)) continue;

    const list = coordsByPincode.get(pin);
    if (list) {
      list.push(normalized);
    } else {
      coordsByPincode.set(pin, [normalized]);
    }
  }

  const index: PincodeCoordinate[] = [];
  const lookup = new Map<string, PincodeCoordinate>();

  for (const [pincode, coords] of coordsByPincode) {
    const medLat = median(coords.map((c) => c.lat));
    const medLng = median(coords.map((c) => c.lng));

    // Drop far outliers for the same PIN (bad/shared source rows)
    const clustered = coords.filter(
      (c) => Math.abs(c.lat - medLat) < 0.5 && Math.abs(c.lng - medLng) < 0.5
    );
    const use = clustered.length > 0 ? clustered : coords;

    const entry: PincodeCoordinate = {
      pincode,
      lat: median(use.map((c) => c.lat)),
      lng: median(use.map((c) => c.lng)),
    };

    index.push(entry);
    lookup.set(pincode, entry);
  }

  if (index.length === 0) {
    throw new PincodeServiceError(
      "Unable to find location for this PIN code. Please verify the PIN code and try again.",
      "NO_COORDINATES"
    );
  }

  pincodeIndexCache = index;
  pincodeLookupCache = lookup;

  console.log(
    `[pincodeService] Offline PIN index ready: ${index.length} unique pincodes with coordinates`
  );

  return { index, lookup };
};

/** Eagerly build the geo index (call once at server boot). */
export const warmPincodeIndex = (): void => {
  ensurePincodeIndex();
};

/** Trim + validate Indian 6-digit PIN format (does not require dataset hit). */
export const normalizeIndianPincode = (pincode: string): string => {
  const trimmed = String(pincode ?? "").trim();
  if (!/^[1-9][0-9]{5}$/.test(trimmed)) {
    throw new PincodeServiceError(
      "Please enter a valid 6-digit PIN code.",
      "INVALID_FORMAT"
    );
  }
  return trimmed;
};

// ======================================================================
// 🔑 SYMMETRIC CACHE KEY & MULTI-TIER DISTANCE RESOLVER
// ======================================================================

/**
 * Generates an order-agnostic, symmetric cache key for a pair of Indian PIN codes.
 * Ensures dist(A, B) and dist(B, A) resolve to the identical cache key:
 * e.g., "110001:452001" whether given ("452001", "110001") or ("110001", "452001").
 */
export const getSymmetricPincodePairKey = (
  pincodeA: string,
  pincodeB: string
): string => {
  const normA = normalizeIndianPincode(pincodeA);
  const normB = normalizeIndianPincode(pincodeB);
  return normA < normB ? `${normA}:${normB}` : `${normB}:${normA}`;
};

/**
 * Resolves geographic distance (in kilometers) between two Indian PIN codes using an enterprise Two-Tier caching architecture:
 * 1. Checks L1 In-Memory LRU Cache (nanosecond O(1) hit, bounded to 50k items, 24h TTL)
 * 2. Checks L2 Redis Distributed Cache (geo:dist:<pincodeA>:<pincodeB>, 7-day TTL)
 * 3. On miss, calculates Haversine trigonometric distance once, rounds to 2 decimal places,
 *    and writes asynchronously to L1 and L2.
 * Returns null if either pincode is invalid or has no postal coordinates (never poisons cache with NaN or undefined).
 */
export const getDistanceBetweenPincodes = async (
  pincodeA: string,
  pincodeB: string
): Promise<number | null> => {
  let normA: string;
  let normB: string;

  try {
    normA = normalizeIndianPincode(pincodeA);
    normB = normalizeIndianPincode(pincodeB);
  } catch {
    return null;
  }

  // Identical pincodes have zero distance immediately (no I/O, no trig)
  if (normA === normB) {
    return 0;
  }

  const symmetricKey = normA < normB ? `${normA}:${normB}` : `${normB}:${normA}`;

  // 1. Tier 1: Check In-Memory LRU Cache (O(1), microsecond latency)
  const l1Hit = l1DistanceCache.get(symmetricKey);
  if (typeof l1Hit === "number" && Number.isFinite(l1Hit) && !Number.isNaN(l1Hit)) {
    return l1Hit;
  }

  // 2. Tier 2: Check Distributed Redis Cache (7-day TTL across multi-instance cluster)
  const redisKey = `geo:dist:${symmetricKey}`;
  if (isRedisReady()) {
    try {
      const redis = getRedisClient();
      if (redis) {
        const cachedVal = await redis.get(redisKey);
        if (cachedVal !== null && cachedVal !== undefined) {
          const parsed = parseFloat(cachedVal);
          if (Number.isFinite(parsed) && !Number.isNaN(parsed) && parsed >= 0) {
            const rounded = Math.round(parsed * 100) / 100;
            // Backfill L1 memory cache from L2 hit
            l1DistanceCache.set(symmetricKey, rounded);
            return rounded;
          }
        }
      }
    } catch {
      // Graceful fallback to on-the-fly computation if Redis encounters network timeout or error
    }
  }

  // 3. Cache Miss: Coordinate resolution from validated postal dataset
  const { lookup } = ensurePincodeIndex();
  const coordA = lookup.get(normA);
  const coordB = lookup.get(normB);

  // Defensive Anti-Poisoning: verify coordinates exist and are finite numbers
  if (
    !coordA ||
    !coordB ||
    !Number.isFinite(coordA.lat) ||
    !Number.isFinite(coordA.lng) ||
    !Number.isFinite(coordB.lat) ||
    !Number.isFinite(coordB.lng)
  ) {
    return null;
  }

  const rawDist = calculateDistanceKm(coordA.lat, coordA.lng, coordB.lat, coordB.lng);
  if (!Number.isFinite(rawDist) || Number.isNaN(rawDist) || rawDist < 0) {
    return null;
  }

  // Round to 2 decimal places (kilometers) to maximize cache hit rates while maintaining delivery accuracy
  const roundedDistance = Math.round(rawDist * 100) / 100;

  // Populate L1 cache immediately
  l1DistanceCache.set(symmetricKey, roundedDistance);

  // Asynchronously populate L2 Redis with 7-day TTL (non-blocking fire-and-forget)
  if (isRedisReady()) {
    try {
      const redis = getRedisClient();
      if (redis) {
        redis.set(redisKey, roundedDistance.toString(), "EX", 7 * 86400).catch(() => {});
      }
    } catch {
      // Non-blocking fire-and-forget
    }
  }

  return roundedDistance;
};

/**
 * Resolve a PIN to coordinates and return all unique PINs within radiusKm,
 * sorted by geographic distance (Haversine). Includes the center PIN.
 * Caches results in L1 and L2 for zero-trigonometry repeated calls.
 */
export const getNearbyPincodes = (
  pincode: string,
  radiusKm: number = getServiceRadiusKm()
): NearbyPincode[] => {
  const normalized = normalizeIndianPincode(pincode);
  const effectiveRadius =
    Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : getServiceRadiusKm();

  const cacheKey = `${normalized}:${effectiveRadius}`;
  const l1Hit = l1NearbyPincodesCache.get(cacheKey);
  if (l1Hit) {
    return l1Hit;
  }

  const { index, lookup } = ensurePincodeIndex();

  const center = lookup.get(normalized);
  if (!center) {
    throw new PincodeServiceError(
      "Unable to find location for this PIN code. Please verify the PIN code and try again.",
      "NOT_FOUND"
    );
  }

  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
    throw new PincodeServiceError(
      "Unable to find location for this PIN code. Please verify the PIN code and try again.",
      "NO_COORDINATES"
    );
  }

  // Bounding-box pre-filter (~1° lat ≈ 111 km)
  const latDelta = effectiveRadius / 111;
  const lngDelta =
    effectiveRadius / (111 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.01));

  const nearby = new Map<string, number>();
  nearby.set(normalized, 0);

  for (const item of index) {
    if (
      Math.abs(item.lat - center.lat) > latDelta ||
      Math.abs(item.lng - center.lng) > lngDelta
    ) {
      continue;
    }

    // Check symmetric pair key in L1 distance cache if available
    const pairKey =
      normalized < item.pincode
        ? `${normalized}:${item.pincode}`
        : `${item.pincode}:${normalized}`;
    let distanceKm = l1DistanceCache.get(pairKey);

    if (distanceKm === undefined) {
      const rawDistance = calculateDistanceKm(
        center.lat,
        center.lng,
        item.lat,
        item.lng
      );
      distanceKm = Math.round(rawDistance * 100) / 100;
      l1DistanceCache.set(pairKey, distanceKm);
    }

    if (distanceKm <= effectiveRadius) {
      const existing = nearby.get(item.pincode);
      if (existing === undefined || distanceKm < existing) {
        nearby.set(item.pincode, distanceKm);
      }
    }
  }

  const results = Array.from(nearby.entries())
    .map(([pin, distanceKm]) => ({
      pincode: pin,
      distanceKm: Math.round(distanceKm * 10) / 10,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm || a.pincode.localeCompare(b.pincode));

  l1NearbyPincodesCache.set(cacheKey, results);

  // Asynchronously populate L2 Redis (non-blocking)
  if (isRedisReady()) {
    try {
      const redis = getRedisClient();
      if (redis) {
        redis
          .set(`geo:nearby:${cacheKey}`, JSON.stringify(results), "EX", 7 * 86400)
          .catch(() => {});
      }
    } catch {}
  }

  return results;
};

/** PIN list only — for nursery.deliveryPincodes persistence. */
export const getNearbyPincodeList = (
  pincode: string,
  radiusKm: number = getServiceRadiusKm()
): string[] => getNearbyPincodes(pincode, radiusKm).map((item) => item.pincode);

/**
 * True when stored coverage looks incomplete (empty, or only the primary PIN).
 * Used to backfill nurseries created before nearby lookup worked.
 */
export const isIncompleteDeliveryCoverage = (
  primaryPin: string | undefined | null,
  deliveryPincodes: string[] | undefined | null
): boolean => {
  if (!primaryPin || !/^[1-9][0-9]{5}$/.test(primaryPin.trim())) return false;
  if (!deliveryPincodes || deliveryPincodes.length === 0) return true;
  if (deliveryPincodes.length === 1 && deliveryPincodes[0] === primaryPin.trim()) {
    return true;
  }
  return false;
};

/**
 * Checks whether buyerPincode is within maxDistanceKm of nurseryPincode.
 * Utilizes Two-Tier caching (L1 Memory -> L2 Redis -> Haversine) for sub-millisecond checks.
 */
export const isPincodeServiceable = async (
  buyerPincode: string,
  nurseryPincode: string,
  maxDistanceKm: number = getServiceRadiusKm()
): Promise<boolean> => {
  try {
    const dist = await getDistanceBetweenPincodes(buyerPincode, nurseryPincode);
    if (dist === null) {
      return false;
    }

    const effectiveRadius =
      Number.isFinite(maxDistanceKm) && maxDistanceKm > 0
        ? maxDistanceKm
        : getServiceRadiusKm();

    return dist <= effectiveRadius;
  } catch {
    return false;
  }
};

export interface NurseryServiceabilityProfile {
  businessName?: string;
  businessAddress?: { pinCode?: string };
  deliveryPincodes?: string[];
}

// ======================================================================
// 🚚 TWO-TIER SHIPPING CLASSIFICATION & SERVICEABILITY
// ======================================================================

export const SHIPPING_TYPES = ["HYPERLOCAL_EXPRESS", "NATIONAL_COURIER"] as const;
export type ShippingType = (typeof SHIPPING_TYPES)[number];

export interface CartItemServiceabilityInput {
  productId: string;
  productName: string;
  nurseryId?: string | null;
  category?: string | null;
  itemModel?: string | null;
  shippingType?: string | null;
}

export interface UnserviceableItemPayload {
  productId: string;
  productName: string;
  nurseryName: string;
  nurseryPincode: string;
  shippingType: ShippingType;
  reason: string;
}

export interface CartServiceabilityResult {
  isServiceable: boolean;
  unserviceableItems: UnserviceableItemPayload[];
  shippingGroups: {
    hyperlocalItems: CartItemServiceabilityInput[];
    nationalCourierItems: CartItemServiceabilityInput[];
  };
}

/**
 * 🚚 Resolves authoritative shipping classification for any product or cart item:
 * - Explicit 'NATIONAL_COURIER' or 'HYPERLOCAL_EXPRESS' takes highest precedence.
 * - Dynamic derivation: Non-perishable categories ('pots', 'accessories', 'gardening-tools',
 *   'plant-care', 'seeds-bulbs', 'stands-shelves', 'artificial-dried') -> 'NATIONAL_COURIER'.
 * - Fallback: Missing, undefined, or 'plants' -> 'HYPERLOCAL_EXPRESS' (safe perishable default).
 */
export const resolveProductShippingType = (product?: {
  shippingType?: string | null;
  category?: string | null;
  itemModel?: string | null;
} | null): ShippingType => {
  if (product?.shippingType === "NATIONAL_COURIER") {
    return "NATIONAL_COURIER";
  }
  if (product?.shippingType === "HYPERLOCAL_EXPRESS") {
    return "HYPERLOCAL_EXPRESS";
  }

  const rawCat = String(product?.category || product?.itemModel || "")
    .trim()
    .toLowerCase();

  const nationalCourierCategories = new Set([
    "pots",
    "pot",
    "accessories",
    "accessory",
    "gardening-tools",
    "gardeningtools",
    "tool",
    "tools",
    "plant-care",
    "plantcare",
    "seeds-bulbs",
    "seeds",
    "bulbs",
    "stands-shelves",
    "standsshelves",
    "plant-stands-shelves",
    "plant-stands-and-shelves",
    "plantstands",
    "artificial-dried",
    "artificialdried",
    "artificial",
  ]);

  if (nationalCourierCategories.has(rawCat)) {
    return "NATIONAL_COURIER";
  }

  // Safe fallback to HYPERLOCAL_EXPRESS for live plants or unknown categories
  return "HYPERLOCAL_EXPRESS";
};

/**
 * 📦 Validates whether a destination pincode is reachable via National Courier network.
 * Returns true if the PIN is a valid 6-digit Indian PIN and exists in the postal coordinate registry.
 */
export const isNationalCourierServiceable = (pincode: string): boolean => {
  try {
    const norm = normalizeIndianPincode(pincode);
    const { lookup } = ensurePincodeIndex();
    return lookup.has(norm);
  } catch {
    return false;
  }
};

/**
 * Checks whether a single nursery profile can service the given buyer pincode.
 * 1. Matches against profile.deliveryPincodes if available.
 * 2. Checks cached distance between nursery base pincode and buyer pincode against maxDistanceKm.
 */
export const isNurseryServiceableToPincode = async (
  buyerPincode: string,
  profile: NurseryServiceabilityProfile,
  maxDistanceKm: number = getServiceRadiusKm()
): Promise<boolean> => {
  try {
    const normBuyer = normalizeIndianPincode(buyerPincode);

    // 1. Direct match against nursery's deliveryPincodes array
    if (
      Array.isArray(profile.deliveryPincodes) &&
      profile.deliveryPincodes.includes(normBuyer)
    ) {
      return true;
    }

    // 2. Distance fallback between buyer pincode and nursery businessAddress.pinCode
    const nurseryPin = profile.businessAddress?.pinCode?.trim();
    if (nurseryPin && /^[1-9][0-9]{5}$/.test(nurseryPin)) {
      if (normBuyer === nurseryPin) {
        return true;
      }
      return await isPincodeServiceable(
        normBuyer,
        nurseryPin,
        maxDistanceKm
      );
    }

    return false;
  } catch {
    return false;
  }
};

// ======================================================================
// 🚀 BATCH PRE-FETCHING & SPATIAL PRE-FILTERING FOR CATALOG BROWSING
// ======================================================================

/**
 * Batch pre-resolves serviceability of all active approved nurseries for a customer pincode.
 * Uses Two-Tier L1 (in-memory LRU) & L2 (Redis) cache with 24-hour TTL to eliminate all Haversine calculations.
 * Returns a Set of serviceable nursery identifiers (including NurseryProfile._id and related User._id).
 */
export const getServiceableNurseriesForCatalog = async (
  customerPincode: string,
  maxDistanceKm: number = getServiceRadiusKm()
): Promise<Set<string>> => {
  let normalizedPin: string;
  try {
    normalizedPin = normalizeIndianPincode(customerPincode);
  } catch {
    return new Set<string>();
  }

  const effectiveRadius =
    Number.isFinite(maxDistanceKm) && maxDistanceKm > 0
      ? maxDistanceKm
      : getServiceRadiusKm();

  const cacheKey = `${normalizedPin}:${effectiveRadius}`;

  // 1. Check L1 Memory Cache (nanoseconds O(1))
  const l1Hit = l1ServiceableNurseriesCache.get(cacheKey);
  if (Array.isArray(l1Hit)) {
    return new Set<string>(l1Hit);
  }

  // 2. Check L2 Redis Cache
  const redisKey = `geo:nurseries:${cacheKey}`;
  if (isRedisReady()) {
    try {
      const redis = getRedisClient();
      if (redis) {
        const cachedRaw = await redis.get(redisKey);
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw);
          if (Array.isArray(parsed)) {
            l1ServiceableNurseriesCache.set(cacheKey, parsed);
            return new Set<string>(parsed);
          }
        }
      }
    } catch {
      // Graceful fallback
    }
  }

  // 3. Batch Resolution across active nurseries in a single database query
  let activeNurseries: any[] = [];
  try {
    activeNurseries = await NurseryProfile.find({
      approvalStatus: "Approved",
      isActive: { $ne: false },
    })
      .select("_id nursery businessAddress deliveryPincodes")
      .lean();
  } catch (err: any) {
    console.error(
      "🚨 [pincodeService] Error querying NurseryProfile for catalog serviceability:",
      err?.message || err
    );
    return new Set<string>();
  }

  const serviceableIds: string[] = [];

  // Parallel spatial evaluation using Promise.all (zero sequential waterfalls)
  await Promise.all(
    activeNurseries.map(async (nursery) => {
      // Check A: Direct delivery pincodes match
      const hasDirectCoverage =
        Array.isArray(nursery.deliveryPincodes) &&
        nursery.deliveryPincodes.includes(normalizedPin);

      let isServiceable = hasDirectCoverage;

      // Check B: Haversine distance check via Two-Tier distance cache
      if (!isServiceable && nursery.businessAddress?.pinCode) {
        isServiceable = await isPincodeServiceable(
          normalizedPin,
          nursery.businessAddress.pinCode,
          effectiveRadius
        );
      }

      if (isServiceable) {
        if (nursery._id) {
          serviceableIds.push(nursery._id.toString());
        }
        if (nursery.nursery) {
          serviceableIds.push(nursery.nursery.toString());
        }
      }
    })
  );

  const deduplicatedIds = Array.from(new Set(serviceableIds));

  // Populate L1 cache (24 hours)
  l1ServiceableNurseriesCache.set(cacheKey, deduplicatedIds);

  // Populate L2 Redis cache (24 hours) asynchronously
  if (isRedisReady()) {
    try {
      const redis = getRedisClient();
      if (redis) {
        redis
          .set(redisKey, JSON.stringify(deduplicatedIds), "EX", 86400)
          .catch(() => {});
      }
    } catch {}
  }

  return new Set<string>(deduplicatedIds);
};

/**
 * Evaluates serviceability for a batch of nursery profiles against a customer PIN in parallel.
 * Returns an O(1) Map<nurseryId, boolean>.
 */
export const getBatchNurseryServiceability = async (
  buyerPincode: string,
  nurseries: Array<{ id: string; profile: NurseryServiceabilityProfile }>,
  maxDistanceKm: number = getServiceRadiusKm()
): Promise<Map<string, boolean>> => {
  const serviceabilityMap = new Map<string, boolean>();
  await Promise.all(
    nurseries.map(async ({ id, profile }) => {
      const isServiceable = await isNurseryServiceableToPincode(
        buyerPincode,
        profile,
        maxDistanceKm
      );
      serviceabilityMap.set(id, isServiceable);
    })
  );
  return serviceabilityMap;
};

/**
 * Fast O(1) dictionary lookup to determine if a product is serviceable to a customer.
 * - NATIONAL_COURIER (pots, tools, seeds, fertilizers) returns true immediately (no distance check).
 * - HYPERLOCAL_EXPRESS checks whether the product's fulfilling nursery is in the pre-resolved serviceable set.
 */
export const isProductServiceableToCustomer = (
  product: {
    shippingType?: string | null;
    category?: string | null;
    itemModel?: string | null;
    nursery?: any;
  },
  serviceableNurseryIds: Set<string>
): boolean => {
  if (resolveProductShippingType(product) === "NATIONAL_COURIER") {
    return true;
  }

  const rawNursery = product.nursery;
  const nurseryId =
    typeof rawNursery === "object" && rawNursery !== null
      ? (rawNursery._id?.toString() || rawNursery.id?.toString())
      : typeof rawNursery === "string"
      ? rawNursery
      : null;

  return Boolean(nurseryId && serviceableNurseryIds.has(nurseryId));
};

/**
 * Validates a list of authoritative cart items against their respective nursery profiles and shipping tiers.
 * - HYPERLOCAL_EXPRESS (live plants, soil): enforces strict <= 12km nursery radius check.
 * - NATIONAL_COURIER (pots, tools, seeds, fertilizers, planters): bypasses radius check, requires valid postal delivery.
 * - Mixed Cart Handling: validates each item cleanly according to its tier without cross-tier false rejections.
 */
export const checkCartItemsPincodeServiceability = async (
  shippingPincode: string,
  items: CartItemServiceabilityInput[],
  nurseryProfilesMap: Map<string, NurseryServiceabilityProfile>,
  maxDistanceKm: number = getServiceRadiusKm()
): Promise<CartServiceabilityResult> => {
  const normShippingPin = String(shippingPincode || "").trim();
  const isValidFormat = /^[1-9][0-9]{5}$/.test(normShippingPin);

  const effectiveRadius =
    Number.isFinite(maxDistanceKm) && maxDistanceKm > 0
      ? maxDistanceKm
      : getServiceRadiusKm();

  const hyperlocalItems: CartItemServiceabilityInput[] = [];
  const nationalCourierItems: CartItemServiceabilityInput[] = [];

  for (const item of items) {
    const shippingType = resolveProductShippingType(item);
    if (shippingType === "NATIONAL_COURIER") {
      nationalCourierItems.push(item);
    } else {
      hyperlocalItems.push(item);
    }
  }

  // 1. If destination PIN format is invalid, all items fail immediately
  if (!isValidFormat) {
    const unserviceableItems: UnserviceableItemPayload[] = items.map((i) => {
      const shippingType = resolveProductShippingType(i);
      const profile = i.nurseryId ? nurseryProfilesMap.get(i.nurseryId) : null;
      return {
        productId: i.productId,
        productName: i.productName,
        nurseryName: profile?.businessName || "Unknown Nursery",
        nurseryPincode: profile?.businessAddress?.pinCode || "N/A",
        shippingType,
        reason: "Invalid 6-digit destination PIN code format",
      };
    });
    return {
      isServiceable: false,
      unserviceableItems,
      shippingGroups: { hyperlocalItems, nationalCourierItems },
    };
  }

  // 2. Validate destination PIN exists in Indian postal delivery network
  const isPostalDeliverable = isNationalCourierServiceable(normShippingPin);
  if (!isPostalDeliverable) {
    const unserviceableItems: UnserviceableItemPayload[] = items.map((i) => {
      const shippingType = resolveProductShippingType(i);
      const profile = i.nurseryId ? nurseryProfilesMap.get(i.nurseryId) : null;
      return {
        productId: i.productId,
        productName: i.productName,
        nurseryName: profile?.businessName || "Unknown Nursery",
        nurseryPincode: profile?.businessAddress?.pinCode || "N/A",
        shippingType,
        reason: `Destination PIN ${normShippingPin} is not recognized in the postal network`,
      };
    });
    return {
      isServiceable: false,
      unserviceableItems,
      shippingGroups: { hyperlocalItems, nationalCourierItems },
    };
  }

  const unserviceableItems: UnserviceableItemPayload[] = [];

  // 3. Evaluate National Courier Items:
  // National Courier items (pots, tools, seeds, planters, artificial plants)
  // require ONLY postal deliverability (verified above) and are free from radius limits.

  // 4. Evaluate Hyperlocal Items:
  // Perishable live plants / soil mixtures require proximity within maxDistanceKm (default 12km).
  if (hyperlocalItems.length > 0) {
    const uniqueHyperlocalNurseryIds = Array.from(
      new Set(
        hyperlocalItems
          .map((i) => i.nurseryId)
          .filter((id): id is string => Boolean(id))
      )
    );

    const nurseryServiceability = new Map<
      string,
      { isServiceable: boolean; nurseryName: string; nurseryPincode: string }
    >();

    await Promise.all(
      uniqueHyperlocalNurseryIds.map(async (nurseryId) => {
        const profile = nurseryProfilesMap.get(nurseryId);
        const nurseryName = profile?.businessName || "Unknown Nursery";
        const nurseryPincode = profile?.businessAddress?.pinCode || "N/A";

        if (!profile) {
          nurseryServiceability.set(nurseryId, {
            isServiceable: false,
            nurseryName,
            nurseryPincode,
          });
          return;
        }

        const serviceable = await isNurseryServiceableToPincode(
          normShippingPin,
          profile,
          effectiveRadius
        );

        nurseryServiceability.set(nurseryId, {
          isServiceable: serviceable,
          nurseryName,
          nurseryPincode,
        });
      })
    );

    for (const item of hyperlocalItems) {
      if (!item.nurseryId) continue;
      const status = nurseryServiceability.get(item.nurseryId);
      if (!status || !status.isServiceable) {
        unserviceableItems.push({
          productId: item.productId,
          productName: item.productName,
          nurseryName: status?.nurseryName || "Unknown Nursery",
          nurseryPincode: status?.nurseryPincode || "N/A",
          shippingType: "HYPERLOCAL_EXPRESS",
          reason: `Item "${item.productName}" is a perishable live plant and cannot be delivered beyond ${effectiveRadius}km`,
        });
      }
    }
  }

  return {
    isServiceable: unserviceableItems.length === 0,
    unserviceableItems,
    shippingGroups: { hyperlocalItems, nationalCourierItems },
  };
};

// ======================================================================
// 📊 CACHE TELEMETRY & AUDIT HELPERS
// ======================================================================

export const getGeoCacheStats = () => ({
  l1DistanceCacheSize: l1DistanceCache.size,
  l1DistanceCacheMaxSize: l1DistanceCache.maxSize,
  l1DistanceCacheTtlMs: l1DistanceCache.ttl,
  l1NearbyCacheSize: l1NearbyPincodesCache.size,
  l1ServiceableNurseriesCacheSize: l1ServiceableNurseriesCache.size,
});

export const clearGeoCaches = (): void => {
  l1DistanceCache.clear();
  l1NearbyPincodesCache.clear();
  l1ServiceableNurseriesCache.clear();
};
