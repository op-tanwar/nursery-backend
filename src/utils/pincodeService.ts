import { loadData } from "india-pincode";

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

/**
 * Resolve a PIN to coordinates and return all unique PINs within radiusKm,
 * sorted by geographic distance (Haversine). Includes the center PIN.
 */
export const getNearbyPincodes = (
  pincode: string,
  radiusKm: number = getServiceRadiusKm()
): NearbyPincode[] => {
  const normalized = normalizeIndianPincode(pincode);
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

  const effectiveRadius =
    Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : getServiceRadiusKm();

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

    const distanceKm = calculateDistanceKm(
      center.lat,
      center.lng,
      item.lat,
      item.lng
    );

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

  console.log(
    `[pincodeService] Primary PIN: ${normalized} | Radius: ${effectiveRadius} km | Nearby PIN count: ${results.length} | center=(${center.lat.toFixed(4)}, ${center.lng.toFixed(4)})`
  );

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
 * Returns true if both PINs are valid and the distance between their geo-coordinates <= maxDistanceKm.
 * If both PINs are identical, immediately returns true (distance 0).
 */
export const isPincodeServiceable = async (
  buyerPincode: string,
  nurseryPincode: string,
  maxDistanceKm: number = getServiceRadiusKm()
): Promise<boolean> => {
  try {
    const normBuyer = normalizeIndianPincode(buyerPincode);
    const normNursery = normalizeIndianPincode(nurseryPincode);

    if (normBuyer === normNursery) {
      return true;
    }

    const { lookup } = ensurePincodeIndex();
    const buyerCoord = lookup.get(normBuyer);
    const nurseryCoord = lookup.get(normNursery);

    if (!buyerCoord || !nurseryCoord) {
      return false;
    }

    const dist = calculateDistanceKm(
      buyerCoord.lat,
      buyerCoord.lng,
      nurseryCoord.lat,
      nurseryCoord.lng
    );

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

export interface UnserviceableItemPayload {
  productId: string;
  productName: string;
  nurseryName: string;
  nurseryPincode: string;
}

/**
 * Checks whether a single nursery profile can service the given buyer pincode.
 * 1. Matches against profile.deliveryPincodes if available.
 * 2. Checks Haversine distance between nursery base pincode and buyer pincode against maxDistanceKm.
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

    // 2. Haversine distance fallback between buyer pincode and nursery businessAddress.pinCode
    const nurseryPin = profile.businessAddress?.pinCode?.trim();
    if (nurseryPin && /^[1-9][0-9]{5}$/.test(nurseryPin)) {
      if (normBuyer === nurseryPin) {
        return true;
      }
      const isWithinRadius = await isPincodeServiceable(
        normBuyer,
        nurseryPin,
        maxDistanceKm
      );
      if (isWithinRadius) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
};

/**
 * Validates a list of authoritative cart items against their respective nursery profiles for a destination pincode.
 * Deduplicates nursery lookups and runs serviceability checks in parallel.
 */
export const checkCartItemsPincodeServiceability = async (
  shippingPincode: string,
  items: Array<{
    productId: string;
    productName: string;
    nurseryId?: string | null;
  }>,
  nurseryProfilesMap: Map<string, NurseryServiceabilityProfile>,
  maxDistanceKm: number = getServiceRadiusKm()
): Promise<{
  isServiceable: boolean;
  unserviceableItems: UnserviceableItemPayload[];
}> => {
  const normShippingPin = String(shippingPincode || "").trim();
  const isValidFormat = /^[1-9][0-9]{5}$/.test(normShippingPin);

  // Deduplicate unique nursery IDs
  const uniqueNurseryIds = Array.from(
    new Set(
      items
        .map((i) => i.nurseryId)
        .filter((id): id is string => Boolean(id))
    )
  );

  // If no items belong to a specific nursery (e.g. platform products), cart is serviceable
  if (uniqueNurseryIds.length === 0) {
    return {
      isServiceable: true,
      unserviceableItems: [],
    };
  }

  // If destination PIN format is invalid, all vendor items are immediately unserviceable
  if (!isValidFormat) {
    return {
      isServiceable: false,
      unserviceableItems: items
        .filter((i) => Boolean(i.nurseryId))
        .map((i) => ({
          productId: i.productId,
          productName: i.productName,
          nurseryName:
            (i.nurseryId && nurseryProfilesMap.get(i.nurseryId)?.businessName) ||
            "Unknown Nursery",
          nurseryPincode:
            (i.nurseryId &&
              nurseryProfilesMap.get(i.nurseryId)?.businessAddress?.pinCode) ||
            "N/A",
        })),
    };
  }

  // Evaluate each unique nursery in parallel
  const nurseryServiceability = new Map<
    string,
    { isServiceable: boolean; nurseryName: string; nurseryPincode: string }
  >();

  await Promise.all(
    uniqueNurseryIds.map(async (nurseryId) => {
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
        maxDistanceKm
      );

      nurseryServiceability.set(nurseryId, {
        isServiceable: serviceable,
        nurseryName,
        nurseryPincode,
      });
    })
  );

  const unserviceableItems: UnserviceableItemPayload[] = [];

  for (const item of items) {
    if (!item.nurseryId) continue;
    const status = nurseryServiceability.get(item.nurseryId);
    if (!status || !status.isServiceable) {
      unserviceableItems.push({
        productId: item.productId,
        productName: item.productName,
        nurseryName: status?.nurseryName || "Unknown Nursery",
        nurseryPincode: status?.nurseryPincode || "N/A",
      });
    }
  }

  return {
    isServiceable: unserviceableItems.length === 0,
    unserviceableItems,
  };
};

