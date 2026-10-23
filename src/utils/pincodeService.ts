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
