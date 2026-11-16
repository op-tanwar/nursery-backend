import axios from "axios";

const REVALIDATION_SECRET =
  process.env.REVALIDATION_SECRET_TOKEN ||
  process.env.REVALIDATE_SECRET ||
  "planto_secure_revalidate_token_2026";

const DEFAULT_FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.NEXT_PUBLIC_FRONTEND_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://urbannursery-neon.vercel.app"
    : "http://localhost:3000");

export interface RevalidationPayload {
  tags?: string[];
  paths?: string[];
}

/**
 * ⚡ Triggers Next.js On-Demand Revalidation to immediately purge Vercel edge/ISR caches
 * when products or nursery active status changes.
 */
export async function triggerFrontendRevalidation(
  payload?: RevalidationPayload
): Promise<boolean> {
  const defaultTags = ["shop-catalog", "products", "featured-plants", "featured-pots"];
  const defaultPaths = [
    "/",
    "/shop",
    "/shop/plants",
    "/shop/pots",
    "/shop/accessories",
    "/shop/gardening-tools",
    "/shop/plant-care",
    "/shop/seeds-bulbs",
    "/shop/plant-stands-shelves",
    "/shop/artificial-dried-plants",
  ];

  const body = {
    tags: Array.from(new Set([...(payload?.tags || []), ...defaultTags])),
    paths: Array.from(new Set([...(payload?.paths || []), ...defaultPaths])),
  };

  const frontendUrl = DEFAULT_FRONTEND_URL.replace(/\/+$/, "");
  const targetEndpoint = `${frontendUrl}/api/revalidate`;

  try {
    const res = await axios.post(targetEndpoint, body, {
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-token": REVALIDATION_SECRET,
      },
      timeout: 5000,
    });

    if (res.status >= 200 && res.status < 300) {
      console.log(`⚡ [Next.js Revalidation] Purged paths and tags on "${targetEndpoint}":`, res.data);
      return true;
    }
    return false;
  } catch (err: any) {
    console.warn(`⚠️ [Next.js Revalidation] Call to "${targetEndpoint}" failed:`, err?.message || err);
    return false;
  }
}
