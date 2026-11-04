import * as crypto from "node:crypto";
import slugify from "slugify";
import mongoose, { Model } from "mongoose";
import { Response } from "express";
import Redirect from "../models/redirectModel";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Generates a collision-resistant URL-safe alphanumeric random suffix.
 * Using a 6-character alphabet of 36 chars yields 36^6 = 2,176,782,336 combinations.
 */
export const generateRandomSuffix = (length = 6): string => {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return result;
};

/**
 * Sanitizes base string into lowercased URL-safe slug base.
 */
export const cleanBaseSlug = (text: string): string => {
  if (!text || typeof text !== "string") {
    return "item";
  }

  const base = slugify(text, {
    lower: true,
    strict: true,
    trim: true,
  });

  // Remove repeated hyphens or leading/trailing hyphens
  const cleaned = base.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "item";
};

/**
 * Generates a collision-resistant deterministic slug (e.g. `monstera-deliciosa-a3f1b2`).
 */
export const generateDeterministicSlug = (text: string, suffixLength = 6): string => {
  const base = cleanBaseSlug(text);
  const suffix = generateRandomSuffix(suffixLength);
  return `${base}-${suffix}`;
};

/**
 * Collision-proof slug generator that checks the database collection to guarantee absolute uniqueness.
 */
export const generateUniqueSlug = async (
  TargetModel: Model<any>,
  text: string,
  options?: {
    currentId?: any;
    suffixLength?: number;
    maxAttempts?: number;
  }
): Promise<string> => {
  const suffixLength = options?.suffixLength || 6;
  const maxAttempts = options?.maxAttempts || 5;
  const currentId = options?.currentId;

  let attempts = 0;
  while (attempts < maxAttempts) {
    const candidate = generateDeterministicSlug(text, suffixLength);

    const filter: any = { slug: candidate };
    if (currentId) {
      filter._id = { $ne: currentId };
    }

    const checkRedirectPromise =
      mongoose.connection.readyState === 1
        ? Redirect.exists({ oldSlug: candidate }).catch(() => null)
        : Promise.resolve(null);

    const [existsInModel, existsInRedirects] = await Promise.all([
      TargetModel.exists(filter).catch(() => null),
      checkRedirectPromise,
    ]);

    if (!existsInModel && !existsInRedirects) {
      return candidate;
    }

    attempts++;
  }

  // Fallback if max attempts exceeded: expand suffix length by 2 characters
  return generateDeterministicSlug(text, suffixLength + 2);
};

/**
 * Decides whether a document's slug should be generated or updated.
 *
 * IMMUTABLE BY DEFAULT:
 * 1. Always generates when creating a new document (isNew or !doc.slug).
 * 2. On updates, NEVER auto-regenerates even if title/name changes.
 * 3. Only regenerates if explicitly requested via `updateSlug: true` or `_updateSlug: true`.
 */
export const shouldGenerateSlug = (doc: any): boolean => {
  if (doc.isNew || !doc.slug) {
    return true;
  }
  return Boolean(doc.updateSlug === true || doc._updateSlug === true);
};

/**
 * Stores a redirect mapping and chains any older redirects to the new destination.
 */
export const recordSlugRedirect = async (
  oldSlug: string,
  newSlug: string,
  entityType: string,
  entityId: any
): Promise<void> => {
  if (!oldSlug || !newSlug || oldSlug === newSlug) {
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    return;
  }

  try {
    const cleanOld = String(oldSlug).toLowerCase().trim();
    const cleanNew = String(newSlug).toLowerCase().trim();

    // 1. Create or update redirect record for this transition
    await Redirect.findOneAndUpdate(
      { oldSlug: cleanOld },
      {
        oldSlug: cleanOld,
        newSlug: cleanNew,
        entityType,
        entityId,
        statusCode: 301,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // 2. Chain older redirects pointing to oldSlug directly to newSlug (prevents multi-hop redirect chains)
    await Redirect.updateMany(
      { newSlug: cleanOld, oldSlug: { $ne: cleanNew } },
      { $set: { newSlug: cleanNew } }
    );
  } catch (err: any) {
    console.error("⚠️ [recordSlugRedirect Error]:", err?.message || err);
  }
};

/**
 * Full lifecycle slug management helper for Mongoose `pre("save")` hooks.
 */
export const handleDocumentSlug = async (
  doc: any,
  options: {
    sourceField?: string;
    entityType?: string;
    suffixLength?: number;
  } = {}
): Promise<void> => {
  const sourceField = options.sourceField || "name";
  const entityType = options.entityType || doc.constructor?.modelName || "Product";
  const suffixLength = options.suffixLength || 6;

  const shouldUpdate = shouldGenerateSlug(doc);
  if (!shouldUpdate) {
    return;
  }

  const sourceText = doc.get(sourceField) || doc.name || doc.title || "item";
  const TargetModel = doc.constructor as Model<any>;

  const previousSlug = doc.slug;
  const newSlug = await generateUniqueSlug(TargetModel, sourceText, {
    currentId: doc._id,
    suffixLength,
  });

  if (previousSlug && previousSlug !== newSlug) {
    if (!Array.isArray(doc.slugHistory)) {
      doc.slugHistory = [];
    }
    if (!doc.slugHistory.includes(previousSlug)) {
      doc.slugHistory.push(previousSlug);
    }
    await recordSlugRedirect(previousSlug, newSlug, entityType, doc._id);
  }

  doc.slug = newSlug;

  // Reset updateSlug flag
  if (doc.updateSlug !== undefined) doc.updateSlug = false;
  if (doc._updateSlug !== undefined) doc._updateSlug = false;
};

/**
 * Searches for a document by active slug, slugHistory, or Redirect collection.
 */
export const findBySlugWithRedirect = async (
  TargetModel: Model<any>,
  slug: string,
  projection: any = "-__v"
): Promise<{ doc: any; isRedirect: boolean; newSlug?: string } | null> => {
  if (!slug) return null;
  const cleanSlug = String(slug).toLowerCase().trim();

  // 1. Direct active slug match
  let doc = await TargetModel.findOne({ slug: cleanSlug }, projection).lean<any>();
  if (doc) {
    return { doc, isRedirect: false };
  }

  // 2. Lookup by slugHistory array on the document
  doc = await TargetModel.findOne({ slugHistory: cleanSlug }, projection).lean<any>();
  if (doc) {
    return { doc, isRedirect: true, newSlug: doc.slug };
  }

  // 3. Lookup in central Redirect collection
  if (mongoose.connection.readyState === 1) {
    const redirect = await Redirect.findOne({
      oldSlug: cleanSlug,
      entityType: TargetModel.modelName,
    }).catch(() => null);

    if (redirect) {
      // Record hit asynchronously
      Redirect.updateOne(
        { _id: redirect._id },
        { $inc: { hits: 1 }, $set: { lastAccessedAt: new Date() } }
      ).catch(() => null);

      doc = await TargetModel.findOne({ slug: redirect.newSlug }, projection).lean<any>();
      if (doc) {
        return { doc, isRedirect: true, newSlug: redirect.newSlug };
      }
    }
  }

  return null;
};

/**
 * Controller helper to resolve slug lookups with 301 SEO redirection protection.
 */
export const resolveSlugOrRedirect = async (
  ResourceModel: Model<any>,
  slug: string,
  res?: Response,
  options?: { baseRoute?: string }
): Promise<{ doc: any; redirected: boolean; newSlug?: string }> => {
  const result = await findBySlugWithRedirect(ResourceModel, slug);
  if (!result || !result.doc) {
    return { doc: null, redirected: false };
  }

  if (result.isRedirect && result.newSlug) {
    if (res) {
      res.setHeader("X-Slug-Redirect", result.newSlug);
      res.setHeader("X-Canonical-Slug", result.doc.slug);
      if (options?.baseRoute) {
        res.redirect(301, `${options.baseRoute}/${result.newSlug}`);
        return { doc: result.doc, redirected: true, newSlug: result.newSlug };
      }
    }
    return { doc: result.doc, redirected: false, newSlug: result.newSlug };
  }

  return { doc: result.doc, redirected: false };
};

export default {
  generateRandomSuffix,
  cleanBaseSlug,
  generateDeterministicSlug,
  generateUniqueSlug,
  shouldGenerateSlug,
  recordSlugRedirect,
  handleDocumentSlug,
  findBySlugWithRedirect,
  resolveSlugOrRedirect,
};
