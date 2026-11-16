import { Request, Response, NextFunction } from "express";
import { UploadedFile } from "express-fileupload";
import mongoose from "mongoose";
import { z } from "zod";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import Product, {
  IProduct,
  PRODUCT_CATEGORIES,
  ProductCategory,
} from "../models/productModel";
import NurseryProfile from "../models/nurseryProfileModel";
import Order from "../models/orderModel";
import ApiFeatures from "../utils/apiFeatures";
import cacheManager from "../utils/cacheManager";
import { resolveSlugOrRedirect } from "../utils/slugify";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/uploadHelper";
import {
  getActiveNurseryIds,
  ACTIVE_NURSERIES_CACHE_KEY,
  isNurseryLiveAndActive,
} from "../utils/nurseryUtils";
import {
  getServiceableNurseriesForCatalog,
  normalizeIndianPincode,
} from "../utils/pincodeService";
import { normalizeCategorySlug } from "../constants/categories";

/**
 * 🔒 Strict ownership verification helper
 * Supports both direct User._id and related NurseryProfile._id
 */
const isProductOwner = async (productNursery: any, user: any): Promise<boolean> => {
  if (!user) return false;
  if (user.role === "admin") return true;
  const nurseryStr = productNursery?.toString();
  if (!nurseryStr) return false;
  if (nurseryStr === user._id.toString()) return true;
  const profile = await NurseryProfile.findOne({ nursery: user._id }).select("_id").lean();
  if (profile && nurseryStr === profile._id.toString()) return true;
  return false;
};

// ======================================================================
// 🛡️ 1. ZOD VALIDATION SCHEMAS FOR POLYMORPHIC ATTRIBUTES
// ======================================================================

export const plantAttributesSchema = z.object({
  lightRequirement: z.string().optional(),
  wateringSchedule: z.string().optional(),
  maintenanceLevel: z.string().optional(),
  isPetFriendly: z.preprocess((v) => v === true || v === "true", z.boolean().optional()),
  benefits: z.preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.string()).optional()),
  careInstructions: z.preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.string()).optional()),
  plantType: z.string().optional(),
  subCategory: z.string().optional(),
}).passthrough();

export const potAttributesSchema = z.object({
  material: z.string().optional(),
  color: z.union([z.string(), z.array(z.string())]).optional(),
  dimensions: z.union([
    z.string(),
    z.object({
      height: z.any().optional(),
      diameter: z.any().optional(),
      width: z.any().optional(),
      length: z.any().optional(),
    }),
  ]).optional(),
  drainageHoles: z.union([z.boolean(), z.string()]).optional(),
  hasDrainageHole: z.union([z.boolean(), z.string()]).optional(),
  shape: z.string().optional(),
  isIndoorOutdoor: z.string().optional(),
  includesSaucer: z.union([z.boolean(), z.string()]).optional(),
  subCategory: z.string().optional(),
}).passthrough();

export const accessoryAttributesSchema = z.object({
  material: z.string().optional(),
  brand: z.string().optional(),
  weight: z.union([z.string(), z.number()]).optional(),
  capacity: z.union([z.string(), z.number()]).optional(),
  usageType: z.string().optional(),
  dimensions: z.union([
    z.string(),
    z.object({
      height: z.any().optional(),
      width: z.any().optional(),
      length: z.any().optional(),
    }),
  ]).optional(),
  specifications: z.record(z.string(), z.any()).optional(),
  subCategory: z.string().optional(),
}).passthrough();

export const gardeningToolAttributesSchema = z.object({
  features: z.preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.string()).optional()),
  material: z.string().optional(),
  handleMaterial: z.string().optional(),
  warrantyMonths: z.preprocess(
    (v) => (v !== undefined && v !== "" && v !== null ? Number(v) : undefined),
    z.number().optional()
  ),
  toolType: z.string().optional(),
  subCategory: z.string().optional(),
}).passthrough();

export const plantCareAttributesSchema = z.object({
  composition: z.string().optional(),
  howToUse: z.preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.string()).optional()),
  volumeOrWeight: z.union([z.string(), z.number()]).optional(),
  formType: z.string().optional(),
  suitableFor: z.preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.string()).optional()),
  isOrganic: z.union([z.boolean(), z.string()]).optional(),
  subCategory: z.string().optional(),
}).passthrough();

export const seedsBulbsAttributesSchema = z.object({
  sowingSeason: z.union([z.string(), z.array(z.string())]).optional(),
  germinationTime: z.union([z.string(), z.number()]).optional(),
  germinationDays: z.union([z.string(), z.number()]).optional(),
  quantityPerPack: z.union([z.string(), z.number()]).optional(),
  sunlightRequirement: z.string().optional(),
  seedType: z.string().optional(),
  subCategory: z.string().optional(),
}).passthrough();

export const standsShelvesAttributesSchema = z.object({
  material: z.string().optional(),
  dimensions: z.union([
    z.string(),
    z.object({
      height: z.any().optional(),
      width: z.any().optional(),
      length: z.any().optional(),
    }),
  ]).optional(),
  tierCount: z.preprocess(
    (v) => (v !== undefined && v !== "" && v !== null ? Number(v) : undefined),
    z.number().optional()
  ),
  maxLoadCapacity: z.preprocess(
    (v) => (v !== undefined && v !== null ? String(v) : undefined),
    z.string().optional()
  ),
  weightCapacityKg: z.preprocess(
    (v) => (v !== undefined && v !== null ? String(v) : undefined),
    z.string().optional()
  ),
  isFoldable: z.union([z.boolean(), z.string()]).optional(),
  subCategory: z.string().optional(),
}).passthrough();

export const artificialDriedAttributesSchema = z.object({
  material: z.string().optional(),
  height: z.union([z.string(), z.number()]).optional(),
  color: z.string().optional(),
  brand: z.string().optional(),
  includesVase: z.union([z.boolean(), z.string()]).optional(),
  potIncluded: z.union([z.boolean(), z.string()]).optional(),
  washable: z.union([z.boolean(), z.string()]).optional(),
  specifications: z.record(z.string(), z.any()).optional(),
  subCategory: z.string().optional(),
}).passthrough();

export const validateCategoryAttributes = (
  category: ProductCategory,
  attributes: any
): Record<string, any> => {
  if (!attributes) return {};
  const parsedAttr = typeof attributes === "string" ? JSON.parse(attributes) : attributes;
  const normCat = normalizeCategory(category) || category;

  switch (normCat) {
    case "plants":
      return plantAttributesSchema.parse(parsedAttr);
    case "pots":
    case "pots-planters":
      return potAttributesSchema.parse(parsedAttr);
    case "accessories":
      return accessoryAttributesSchema.parse(parsedAttr);
    case "gardening-tools":
      return gardeningToolAttributesSchema.parse(parsedAttr);
    case "plant-care":
      return plantCareAttributesSchema.parse(parsedAttr);
    case "seeds-bulbs":
      return seedsBulbsAttributesSchema.parse(parsedAttr);
    case "plant-stands-shelves":
    case "plant-stands-and-shelves":
    case "stands-shelves":
      return standsShelvesAttributesSchema.parse(parsedAttr);
    case "artificial-dried":
    case "artificial-dried-plants":
      return artificialDriedAttributesSchema.parse(parsedAttr);
    default:
      return parsedAttr;
  }
};

const COMMON_PRODUCT_KEYS = new Set([
  "name",
  "category",
  "price",
  "discountPrice",
  "stock",
  "description",
  "descriptionOption",
  "isPublished",
  "metaTitle",
  "metaDescription",
  "tags",
  "attributes",
  "nursery",
  "images",
  "coverImage",
  "updateSlug",
]);

const CATEGORY_PAYLOAD_MAP: Record<string, ProductCategory> = {
  plantData: "plants",
  potData: "pots",
  accessoryData: "accessories",
  gardeningToolData: "gardening-tools",
  toolData: "gardening-tools",
  plantCareData: "plant-care",
  careData: "plant-care",
  seedsBulbsData: "seeds-bulbs",
  seedData: "seeds-bulbs",
  plantStandsShelvesData: "plant-stands-shelves",
  standData: "plant-stands-shelves",
  artificialDriedPlantData: "artificial-dried",
  artificialData: "artificial-dried",
  productData: "plants",
};

export const normalizeCategory = (cat?: any): ProductCategory | undefined => {
  if (!cat || typeof cat !== "string") return undefined;
  const canonical = normalizeCategorySlug(cat);
  if (canonical && PRODUCT_CATEGORIES.includes(canonical as ProductCategory)) {
    return canonical as ProductCategory;
  }
  const c = cat.toLowerCase().trim();
  if (PRODUCT_CATEGORIES.includes(c as ProductCategory)) {
    return c as ProductCategory;
  }
  return undefined;
};

export const extractProductPayload = (body: any) => {
  const payloadKeys = [
    "productData",
    "plantData",
    "potData",
    "accessoryData",
    "gardeningToolData",
    "toolData",
    "plantCareData",
    "careData",
    "seedsBulbsData",
    "seedData",
    "plantStandsShelvesData",
    "standData",
    "artificialDriedPlantData",
    "artificialData",
  ];
  let extracted = { ...body };
  let detectedCategory: ProductCategory | undefined = normalizeCategory(body.category);
  let subCategory: string | undefined = undefined;

  for (const key of payloadKeys) {
    if (body[key]) {
      try {
        const parsed = typeof body[key] === "string" ? JSON.parse(body[key]) : body[key];
        if (CATEGORY_PAYLOAD_MAP[key]) {
          detectedCategory = CATEGORY_PAYLOAD_MAP[key];
        }
        if (parsed.category) {
          const norm = normalizeCategory(parsed.category);
          if (norm) {
            detectedCategory = norm;
          } else {
            subCategory = parsed.category;
          }
        }
        extracted = { ...extracted, ...parsed };
      } catch (e) {}
    }
  }

  // Ensure category is the valid top-level ProductCategory
  if (detectedCategory) {
    extracted.category = detectedCategory;
  } else if (extracted.category) {
    const norm = normalizeCategory(extracted.category);
    if (norm) extracted.category = norm;
  }

  // Parse base attributes if provided as JSON string or object
  let baseAttrs: Record<string, any> = {};
  if (extracted.attributes) {
    if (typeof extracted.attributes === "string") {
      try {
        baseAttrs = JSON.parse(extracted.attributes);
      } catch (e) {
        baseAttrs = {};
      }
    } else if (typeof extracted.attributes === "object" && extracted.attributes !== null) {
      baseAttrs = { ...extracted.attributes };
    }
  }

  // If specifications object was provided (accessories, artificial-dried), merge into baseAttrs
  if (extracted.specifications && typeof extracted.specifications === "object") {
    baseAttrs = { ...extracted.specifications, ...baseAttrs };
  }

  // Gather any non-common top-level fields into baseAttrs
  for (const [k, v] of Object.entries(extracted)) {
    if (
      !COMMON_PRODUCT_KEYS.has(k) &&
      !payloadKeys.includes(k) &&
      k !== "attributes" &&
      k !== "subCategory" &&
      k !== "specifications"
    ) {
      if (baseAttrs[k] === undefined && v !== undefined) {
        baseAttrs[k] = v;
      }
    }
  }

  // If subCategory was parsed from legacy category field, retain it in attributes
  if (subCategory && !baseAttrs.subCategory) {
    baseAttrs.subCategory = subCategory;
  }

  extracted.attributes = baseAttrs;
  return extracted;
};

// ======================================================================
// 🚀 2. UNIFIED PRODUCT CONTROLLERS
// ======================================================================

/**
 * ➕ CREATE A NEW UNIFIED PRODUCT
 * POST /api/v1/products
 */
export const createProduct = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(new ErrorHandler("Unauthorized", 401));

    const payload = extractProductPayload(req.body);
    const {
      name,
      category,
      price,
      discountPrice,
      stock,
      description,
      descriptionOption,
      isPublished,
      metaTitle,
      metaDescription,
      tags,
      attributes,
      nursery: requestedNursery,
    } = payload;

    if (!name || !category || price === undefined || stock === undefined || !description) {
      return next(new ErrorHandler("Name, category, price, stock, and description are required.", 400));
    }

    if (!PRODUCT_CATEGORIES.includes(category)) {
      return next(
        new ErrorHandler(
          `Invalid category "${category}". Allowed categories: ${PRODUCT_CATEGORIES.join(", ")}`,
          400
        )
      );
    }

    // Resolve target nursery ID & active status:
    let nurseryId: any = null;
    let isNurseryActive = true;
    if (user.role === "admin" && requestedNursery) {
      nurseryId = requestedNursery;
      isNurseryActive = await isNurseryLiveAndActive(nurseryId);
    } else {
      // Find nursery profile belonging to the authenticated user
      const profile = await NurseryProfile.findOne({ nursery: user._id });
      nurseryId = profile ? profile._id : user._id;
      isNurseryActive = profile
        ? profile.isActive !== false && profile.approvalStatus === "Approved"
        : user.isActive !== false && user.status !== "Suspended";
    }

    // Validate category polymorphic attributes
    let validatedAttributes: Record<string, any> = {};
    try {
      validatedAttributes = validateCategoryAttributes(category, attributes);
    } catch (err: any) {
      return next(new ErrorHandler(`Invalid attributes for ${category}: ${err.message}`, 400));
    }

    // Process image uploads if files provided via multipart/form-data
    const images: { url: string; public_id: string }[] = [];
    let uploadedCoverImage: { url: string; public_id: string } | undefined = undefined;

    if (req.files) {
      const filesObj = req.files;

      // Handle coverImage if uploaded separately
      if (filesObj.coverImage) {
        const coverFile = Array.isArray(filesObj.coverImage) ? filesObj.coverImage[0] : filesObj.coverImage;
        const upload = await uploadToCloudinary(coverFile, `urban-nursery/products/${category}/cover`);
        uploadedCoverImage = { url: upload.url, public_id: upload.publicId };
        images.push(uploadedCoverImage);
      }

      const galleryList: UploadedFile[] = [];
      for (const key of Object.keys(filesObj)) {
        if (key === "coverImage") continue;
        const item = filesObj[key];
        if (Array.isArray(item)) {
          galleryList.push(...item);
        } else {
          galleryList.push(item);
        }
      }

      for (const file of galleryList) {
        const upload = await uploadToCloudinary(file, `urban-nursery/products/${category}`);
        images.push({
          url: upload.url,
          public_id: upload.publicId,
        });
      }
    } else if (payload.images && Array.isArray(payload.images)) {
      images.push(...payload.images);
    }

    const product = await Product.create({
      name,
      category,
      nursery: nurseryId,
      price: Number(price),
      discountPrice: discountPrice !== undefined && discountPrice !== "" ? Number(discountPrice) : 0,
      stock: Number(stock),
      description,
      descriptionOption: typeof descriptionOption === "string" ? JSON.parse(descriptionOption) : descriptionOption,
      isPublished: isPublished !== undefined ? Boolean(isPublished) : true,
      isNurseryActive,
      images,
      coverImage: uploadedCoverImage || images[0] || (payload.coverImage ? payload.coverImage : undefined),
      metaTitle,
      metaDescription,
      tags: typeof tags === "string" ? tags.split(",").map((t: string) => t.trim()) : tags,
      attributes: validatedAttributes,
    });

    // Invalidate product catalog and active nursery cache
    await cacheManager.invalidatePattern("catalog:");
    await cacheManager.invalidatePattern("products:");
    await cacheManager.del(ACTIVE_NURSERIES_CACHE_KEY);

    res.status(201).json({
      success: true,
      message: "Product created successfully.",
      product,
      plant: product,
      pot: product,
      accessory: product,
      gardeningTool: product,
      plantCare: product,
      seedsBulbs: product,
      plantStandsShelves: product,
      stand: product,
      artificial: product,
      artificialDriedPlant: product,
    });
  }
);

/**
 * 🔍 GET ALL PRODUCTS (UNIFIED FAST PAGINATED & FILTERED CATALOG)
 * GET /api/v1/products
 */
export const getAllProducts = catchAsyncErrors(
  async (req: Request, res: Response, _next: NextFunction) => {
    const requestedLimit = Number(req.query.limit);
    const resultsPerPage =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), 48)
        : 12;

    const {
      category,
      type,
      nursery,
      vendor,
      isPublished,
      minPrice,
      maxPrice,
      subCategory,
      pincode,
      pinCode,
      postalCode,
      ...otherQueries
    } = req.query;

    const baseFilter: any = {};

    // Filter by active status for customer view unless explicitly queried by admin/nursery
    if (req.user?.role === "admin") {
      if (isPublished !== undefined) {
        baseFilter.isPublished = String(isPublished) === "true";
      }
    } else {
      // 🛡️ STRICT POSITIVE WHITELIST FOR CUSTOMER VIEW & PUBLIC STOREFRONT
      baseFilter.isPublished = true;
      baseFilter.isActive = true;
      baseFilter.isNurseryActive = true;
    }

    const effectiveCategory = category || (type && type !== "All" && type !== "all" ? type : undefined);
    const normCategory = normalizeCategory(effectiveCategory);
    if (normCategory) {
      if (normCategory === "plant-stands-shelves" || normCategory === "stands-shelves") {
        baseFilter.category = { $in: ["plant-stands-shelves", "stands-shelves"] };
      } else {
        baseFilter.category = normCategory;
      }
    }

    // Subcategory matching (matches attributes.subCategory or tags)
    if (subCategory && typeof subCategory === "string" && subCategory.trim() !== "" && subCategory !== "All") {
      const cleanSub = subCategory.trim();
      const escapedSub = cleanSub.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const subRegex = new RegExp(`^${escapedSub}$`, "i");
      baseFilter.$or = [
        { "attributes.subCategory": subRegex },
        { tags: subRegex },
      ];
    }

    // Vendor / Nursery filter with strict active check
    const targetNursery = nursery || vendor;
    let activeNurseryIds: string[] = [];

    if (req.user?.role !== "admin") {
      baseFilter.isNurseryActive = true;
      activeNurseryIds = await getActiveNurseryIds();
      const activeObjectIds = activeNurseryIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      const allActiveQueryIds = [...activeNurseryIds, ...activeObjectIds];

      if (targetNursery && typeof targetNursery === "string") {
        const relatedProfile = await NurseryProfile.findOne({
          $or: [
            { _id: mongoose.isValidObjectId(targetNursery) ? targetNursery : null },
            { nursery: mongoose.isValidObjectId(targetNursery) ? targetNursery : null },
            { slug: targetNursery },
          ],
        })
          .select("_id nursery")
          .lean();

        if (relatedProfile) {
          const nurseryIds = [
            relatedProfile._id.toString(),
            relatedProfile.nursery ? relatedProfile.nursery.toString() : "",
          ].filter(Boolean);

          const liveIds = nurseryIds.filter((id) => activeNurseryIds.includes(id));
          const liveObjectIds = liveIds
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));
          baseFilter.nursery = { $in: [...liveIds, ...liveObjectIds] };
        } else {
          baseFilter.nursery = activeNurseryIds.includes(targetNursery)
            ? (mongoose.isValidObjectId(targetNursery) ? new mongoose.Types.ObjectId(targetNursery) : targetNursery)
            : { $in: [] };
        }
      } else {
        baseFilter.nursery = { $in: allActiveQueryIds };
      }
    } else if (targetNursery && typeof targetNursery === "string") {
      const relatedProfile = await NurseryProfile.findOne({
        $or: [
          { _id: mongoose.isValidObjectId(targetNursery) ? targetNursery : null },
          { nursery: mongoose.isValidObjectId(targetNursery) ? targetNursery : null },
          { slug: targetNursery },
        ],
      })
        .select("_id nursery")
        .lean();

      if (relatedProfile) {
        const nurseryIds = [
          relatedProfile._id.toString(),
          relatedProfile.nursery ? relatedProfile.nursery.toString() : "",
        ].filter(Boolean);
        baseFilter.nursery = { $in: nurseryIds };
      } else {
        baseFilter.nursery = targetNursery;
      }
    }

    // Price range filter
    if (minPrice !== undefined || maxPrice !== undefined) {
      baseFilter.price = {};
      if (minPrice !== undefined) baseFilter.price.$gte = Number(minPrice);
      if (maxPrice !== undefined) baseFilter.price.$lte = Number(maxPrice);
    }

    // 🚚 Geographic Serviceability & Catalog Pre-filtering Optimization:
    // If the category is non-perishable (pots, tools, seeds, fertilizers, accessories),
    // bypass the distance check entirely before hitting the geo module.
    const isNationalCourierCategory =
      normCategory &&
      [
        "pots",
        "accessories",
        "gardening-tools",
        "plant-care",
        "seeds-bulbs",
        "stands-shelves",
        "artificial-dried",
      ].includes(normCategory);

    const rawCustomerPin = (pincode || pinCode || postalCode) as string | undefined;

    if (rawCustomerPin && !isNationalCourierCategory) {
      let cleanCustomerPin: string | null = null;
      try {
        cleanCustomerPin = normalizeIndianPincode(String(rawCustomerPin));
      } catch {
        // Invalid pin code format provided
      }

      if (cleanCustomerPin) {
        // Batch pre-fetch distinct serviceable nurseries ONCE per catalog request via Two-Tier cache
        const serviceableNurseryIds = await getServiceableNurseriesForCatalog(cleanCustomerPin);

        if (!targetNursery) {
          if (serviceableNurseryIds.size > 0) {
            const activeServiceable = Array.from(serviceableNurseryIds).filter((id) =>
              activeNurseryIds.includes(id)
            );
            const activeServiceableObjIds = activeServiceable
              .filter((id) => mongoose.Types.ObjectId.isValid(id))
              .map((id) => new mongoose.Types.ObjectId(id));

            const geoOrCondition = [
              { shippingType: "NATIONAL_COURIER" },
              { nursery: { $in: [...activeServiceable, ...activeServiceableObjIds] } },
            ];
            if (!baseFilter.$or) {
              baseFilter.$or = geoOrCondition;
            } else if (!baseFilter.$and) {
              baseFilter.$and = [{ $or: baseFilter.$or }, { $or: geoOrCondition }];
              delete baseFilter.$or;
            } else {
              baseFilter.$and.push({ $or: geoOrCondition });
            }
          } else {
            // No local nurseries serviceable for this pincode; show only courier-deliverable products
            baseFilter.shippingType = "NATIONAL_COURIER";
          }
        }
      }
    }

    // Apply ApiFeatures (Safe Regex search, sorting, whitelisted filtering, pagination)
    const features = new ApiFeatures(Product.find(baseFilter), otherQueries)
      .search(["name", "category", "description", "tags"])
      .filter()
      .sort("-createdAt");

    const countQuery = features.query.clone().countDocuments();
    features.pagination(resultsPerPage);

    const [totalCount, filteredCount, rawProducts] = await Promise.all([
      Product.countDocuments(baseFilter),
      countQuery,
      features.query
        .populate("nursery", "businessName slug businessAddress.city logo isActive approvalStatus status isBlocked")
        .select("-__v")
        .lean(),
    ]);

    // 🛡️ Defense-in-depth: Post-query filter to guarantee zero suspended leaks
    let finalProducts = rawProducts;
    if (req.user?.role !== "admin") {
      const activeSet = new Set(activeNurseryIds);
      finalProducts = rawProducts.filter((p: any) => {
        if (p.isNurseryActive !== true) return false;
        if (p.isPublished !== true || p.isActive !== true) return false;
        if (!p.nursery) return false;
        const nurseryId =
          typeof p.nursery === "object" && p.nursery._id
            ? p.nursery._id.toString()
            : p.nursery.toString();
        return activeSet.has(nurseryId);
      });
    }

    res.status(200).json({
      success: true,
      totalCount,
      filteredCount,
      totalProducts: filteredCount,
      resultsPerPage,
      count: finalProducts.length,
      products: finalProducts,
    });
  }
);

/**
 * 🌟 GET FEATURED / BEST-SELLING PRODUCTS (GLOBAL OR HYPERLOCAL PINCODE)
 * GET /api/v1/products/featured
 * Query params: ?category=plants|pots, ?pincode=452001, ?limit=8
 */
export const getFeaturedProducts = catchAsyncErrors(
  async (req: Request, res: Response, _next: NextFunction) => {
    const requestedLimit = Number(req.query.limit);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), 48)
        : 8;

    const { category, pincode, pinCode, postalCode } = req.query;
    const rawCustomerPin = (pincode || pinCode || postalCode) as string | undefined;

    // 1. Base active & in-stock filter - STRICT POSITIVE WHITELIST
    const baseFilter: any = {
      isPublished: true,
      isActive: true,
      isNurseryActive: true,
      stock: { $gt: 0 },
    };

    // Filter out inactive nurseries for non-admins
    let activeNurseryIds: string[] = [];
    if (mongoose.connection.readyState === 1 && req.user?.role !== "admin") {
      try {
        activeNurseryIds = await getActiveNurseryIds();
        const activeObjectIds = activeNurseryIds
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
          .map((id) => new mongoose.Types.ObjectId(id));
        baseFilter.nursery = { $in: [...activeNurseryIds, ...activeObjectIds] };
      } catch (err: any) {
        baseFilter.nursery = { $in: [] };
        console.warn("⚠️ [getFeaturedProducts] Failed to retrieve active nurseries:", err?.message || err);
      }
    }

    // 2. Category Normalization & Matching
    const normCategory = normalizeCategory(category);
    if (normCategory) {
      if (normCategory === "plant-stands-shelves" || normCategory === "stands-shelves") {
        baseFilter.category = { $in: ["plant-stands-shelves", "stands-shelves"] };
      } else if (normCategory === "pots") {
        baseFilter.category = { $in: ["pots", "pots-planters"] };
      } else {
        baseFilter.category = normCategory;
      }
    }

    // 3. Resolve Delivery Pincode & Serviceability
    let cleanCustomerPin: string | null = null;
    if (rawCustomerPin) {
      try {
        cleanCustomerPin = normalizeIndianPincode(String(rawCustomerPin));
      } catch {
        cleanCustomerPin = null;
      }
    }

    // Graceful offline/disconnected fallback
    if (mongoose.connection.readyState !== 1) {
      return res.status(200).json({
        success: true,
        count: 0,
        category: normCategory || "all",
        pincode: cleanCustomerPin,
        isHyperlocal: Boolean(cleanCustomerPin),
        products: [],
        plants: normCategory === "plants" ? [] : undefined,
        pots: normCategory === "pots" ? [] : undefined,
      });
    }

    const isNationalCourierCategory =
      normCategory &&
      [
        "pots",
        "pots-planters",
        "accessories",
        "gardening-tools",
        "plant-care",
        "seeds-bulbs",
        "stands-shelves",
        "plant-stands-shelves",
        "artificial-dried",
      ].includes(normCategory);

    let serviceableProducts: any[] = [];
    const localSalesMap = new Map<string, number>();

    // 4. Branch: Pincode Provided vs Global
    if (cleanCustomerPin) {
      // A. Query local order aggregation for products sold within this pincode
      try {
        const localSalesAgg = await Order.aggregate([
          {
            $match: {
              "shippingInfo.pinCode": String(cleanCustomerPin),
              orderStatus: { $ne: "Cancelled" },
            },
          },
          { $unwind: "$orderItems" },
          {
            $group: {
              _id: "$orderItems.item",
              localSold: { $sum: "$orderItems.quantity" },
            },
          },
          { $sort: { localSold: -1 } },
          { $limit: limit * 4 },
        ]);

        for (const record of localSalesAgg) {
          if (record._id) {
            localSalesMap.set(String(record._id), record.localSold);
          }
        }
      } catch (err: any) {
        console.warn("⚠️ [getFeaturedProducts] Local sales aggregation fallback:", err?.message || err);
      }

      // B. Apply geographic serviceability filter
      const pinFilter = { ...baseFilter };

      if (!isNationalCourierCategory) {
        // Perishable plants require hyperlocal serviceable nursery radius or national courier
        const serviceableNurseryIds = await getServiceableNurseriesForCatalog(cleanCustomerPin);

        if (serviceableNurseryIds && serviceableNurseryIds.size > 0) {
          const activeServiceable = Array.from(serviceableNurseryIds).filter((id) =>
            activeNurseryIds.includes(id)
          );
          const activeServiceableObjIds = activeServiceable
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));

          const geoOrCondition = [
            { shippingType: "NATIONAL_COURIER" },
            { nursery: { $in: [...activeServiceable, ...activeServiceableObjIds] } },
          ];
          pinFilter.$or = geoOrCondition;
        } else {
          // No local nurseries serviceable for this pincode; show courier-deliverable products only
          pinFilter.shippingType = "NATIONAL_COURIER";
        }
      }

      // Query candidate active products in that category matching serviceability
      const candidates = await Product.find(pinFilter)
        .populate("nursery", "businessName slug businessAddress.city logo isActive approvalStatus status isBlocked")
        .select("-__v")
        .lean();

      // Weighted ranking:
      // 1. Local sales in this pincode
      // 2. Global sales count (sold / soldCount)
      // 3. Ratings (ratingsAverage / ratings)
      // 4. Newest (createdAt)
      candidates.sort((a: any, b: any) => {
        const aLocal = localSalesMap.get(String(a._id)) || 0;
        const bLocal = localSalesMap.get(String(b._id)) || 0;
        if (bLocal !== aLocal) return bLocal - aLocal;

        const aSold = a.sold ?? a.soldCount ?? 0;
        const bSold = b.sold ?? b.soldCount ?? 0;
        if (bSold !== aSold) return bSold - aSold;

        const aRating = a.ratingsAverage ?? a.ratings ?? 0;
        const bRating = b.ratingsAverage ?? b.ratings ?? 0;
        if (bRating !== aRating) return bRating - aRating;

        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      serviceableProducts = candidates.slice(0, limit);

      // Safe Fallback: If fewer than limit items found for this pincode and it was a national category,
      // pad with top global best-sellers if applicable to keep UI full
      if (serviceableProducts.length < limit && isNationalCourierCategory) {
        const existingIds = new Set(serviceableProducts.map((p) => String(p._id)));
        const fallbackItems = await Product.find({
          ...baseFilter,
          _id: { $nin: Array.from(existingIds) },
        })
          .sort({ sold: -1, ratingsAverage: -1, ratings: -1, createdAt: -1 })
          .limit(limit - serviceableProducts.length)
          .populate("nursery", "businessName slug businessAddress.city logo isActive approvalStatus status isBlocked")
          .select("-__v")
          .lean();

        serviceableProducts.push(...fallbackItems);
      }
    } else {
      // 5. Global Best-Sellers (No Pincode provided)
      serviceableProducts = await Product.find(baseFilter)
        .sort({ sold: -1, ratingsAverage: -1, ratings: -1, createdAt: -1 })
        .limit(limit)
        .populate("nursery", "businessName slug businessAddress.city logo isActive approvalStatus status isBlocked")
        .select("-__v")
        .lean();
    }

    // 🛡️ Defense-in-depth: Post-query filter to guarantee zero leaks
    if (req.user?.role !== "admin") {
      const activeSet = new Set(activeNurseryIds);
      serviceableProducts = serviceableProducts.filter((p: any) => {
        if (p.isNurseryActive !== true) return false;
        if (p.isPublished !== true || p.isActive !== true) return false;
        if (!p.nursery) return false;
        const nurseryId =
          typeof p.nursery === "object" && p.nursery._id
            ? p.nursery._id.toString()
            : p.nursery.toString();
        return activeSet.has(nurseryId);
      });
    }

    // Attach response payload with polymorphic and category-specific keys
    return res.status(200).json({
      success: true,
      count: serviceableProducts.length,
      category: normCategory || "all",
      pincode: cleanCustomerPin,
      isHyperlocal: Boolean(cleanCustomerPin),
      products: serviceableProducts,
      plants: normCategory === "plants" ? serviceableProducts : undefined,
      pots: normCategory === "pots" ? serviceableProducts : undefined,
    });
  }
);

/**
 * 📦 GET PRODUCT BY ID OR SLUG (SINGLE QUERY RESOLVER WITH 301 REDIRECT SUPPORT)
 * GET /api/v1/products/:idOrSlug
 */
export const getProductByIdOrSlug = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawParam = req.params.idOrSlug;
    const param = String(Array.isArray(rawParam) ? rawParam[0] : rawParam).trim();

    if (!param) {
      return next(new ErrorHandler("Product ID or slug is required.", 400));
    }

    let product = null;

    // 1. Direct ObjectId lookup
    if (mongoose.Types.ObjectId.isValid(param)) {
      product = await Product.findById(param)
        .populate("nursery", "businessName slug businessAddress logo email phone isActive approvalStatus status isBlocked")
        .lean();
    }

    // 2. Direct Slug lookup
    if (!product) {
      product = await Product.findOne({ slug: param.toLowerCase() })
        .populate("nursery", "businessName slug businessAddress logo email phone isActive approvalStatus status isBlocked")
        .lean();
    }

    // 3. Fallback: Slug history & Redirect matrix lookup
    if (!product) {
      const slugResult = await resolveSlugOrRedirect(Product, param, res, {
        baseRoute: "/products",
      });

      if (slugResult.redirected) return;

      if (slugResult.doc) {
        product = await Product.findById(slugResult.doc._id)
          .populate("nursery", "businessName slug businessAddress logo email phone isActive approvalStatus status isBlocked")
          .lean();
      }

      if (!product) {
        return next(new ErrorHandler("Product not found.", 404));
      }
    }

    if (!product) {
      return next(new ErrorHandler("Product not found.", 404));
    }

    // 🛡️ Active & Approved nursery check for public storefront requests
    const isOwner = await isProductOwner(product.nursery, req.user);
    if (!isOwner && req.user?.role !== "admin") {
      if (
        product.isPublished !== true ||
        product.isActive !== true ||
        product.isNurseryActive !== true
      ) {
        return next(new ErrorHandler("Product not found or currently unavailable.", 404));
      }

      if (!product.nursery) {
        return next(new ErrorHandler("Product not found or currently unavailable.", 404));
      }

      const nurseryRef =
        typeof product.nursery === "object" && product.nursery._id
          ? product.nursery._id.toString()
          : product.nursery.toString();
      const isLive = await isNurseryLiveAndActive(nurseryRef);
      if (!isLive) {
        return next(new ErrorHandler("Product not found or currently unavailable.", 404));
      }
    }

    res.status(200).json({
      success: true,
      product,
      plant: product,
      pot: product,
      accessory: product,
      gardeningTool: product,
      plantCare: product,
      seedsBulbs: product,
      plantStandsShelves: product,
      artificial: product,
    });
  }
);

// ======================================================================
// 🎯 SMART PRODUCT RECOMMENDATION & CROSS-SELL AFFINITY ENGINE
// ======================================================================

export const CROSS_SELL_AFFINITY_MATRIX: Record<string, string[]> = {
  plants: ["pots", "plant-care", "accessories", "plant-stands-shelves"],
  pots: ["plants", "plant-care", "plant-stands-shelves", "accessories"],
  "pots-planters": ["plants", "plant-care", "plant-stands-shelves", "accessories"],
  "gardening-tools": ["plant-care", "seeds-bulbs", "accessories", "gardening-tools"],
  "plant-care": ["plants", "seeds-bulbs", "gardening-tools", "pots"],
  "seeds-bulbs": ["plant-care", "pots", "gardening-tools", "accessories"],
  "plant-stands-shelves": ["pots", "plants", "accessories"],
  "stands-shelves": ["pots", "plants", "accessories"],
  "plant-stands-and-shelves": ["pots", "plants", "accessories"],
  "artificial-dried-plants": ["pots", "plant-stands-shelves", "accessories"],
  "artificial-dried": ["pots", "plant-stands-shelves", "accessories"],
  accessories: ["plants", "pots", "plant-care", "gardening-tools"],
};

export function getCategoryDbQueryFilter(categorySlug: string): any {
  const norm = normalizeCategorySlug(categorySlug) || categorySlug.toLowerCase().trim();
  if (norm === "pots" || norm === "pots-planters") {
    return { $in: ["pots", "pots-planters"] };
  }
  if (
    norm === "plant-stands-shelves" ||
    norm === "stands-shelves" ||
    norm === "plant-stands-and-shelves"
  ) {
    return { $in: ["plant-stands-shelves", "stands-shelves", "plant-stands-and-shelves"] };
  }
  if (norm === "artificial-dried" || norm === "artificial-dried-plants") {
    return { $in: ["artificial-dried", "artificial-dried-plants"] };
  }
  return norm;
}

/**
 * 🎯 GET PRODUCT RECOMMENDATIONS (CROSS-SELL & SIMILAR COLLECTIONS)
 * GET /api/v1/products/:idOrSlug/recommendations
 */
export const getProductRecommendations = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawParam = req.params.idOrSlug;
    const param = String(Array.isArray(rawParam) ? rawParam[0] : rawParam).trim();

    if (!param) {
      return next(new ErrorHandler("Product ID or slug is required.", 400));
    }

    const requestedLimit = Number(req.query.limit);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), 12)
        : 4;

    const requestedCrossLimit = Number(req.query.crossLimit);
    const crossLimit =
      Number.isFinite(requestedCrossLimit) && requestedCrossLimit > 0
        ? Math.min(Math.floor(requestedCrossLimit), 8)
        : 3;

    // 1. Look up the source product
    let product: any = null;
    if (mongoose.Types.ObjectId.isValid(param)) {
      product = await Product.findById(param)
        .populate(
          "nursery",
          "businessName slug businessAddress logo email phone isActive approvalStatus status isBlocked"
        )
        .lean();
    }
    if (!product) {
      product = await Product.findOne({ slug: param.toLowerCase() })
        .populate(
          "nursery",
          "businessName slug businessAddress logo email phone isActive approvalStatus status isBlocked"
        )
        .lean();
    }
    if (!product) {
      const slugResult = await resolveSlugOrRedirect(Product, param, res, {
        baseRoute: "/products",
      });
      if (slugResult.redirected) return;
      if (slugResult.doc) {
        product = await Product.findById(slugResult.doc._id)
          .populate(
            "nursery",
            "businessName slug businessAddress logo email phone isActive approvalStatus status isBlocked"
          )
          .lean();
      }
    }

    if (!product) {
      return next(new ErrorHandler("Product not found.", 404));
    }

    // 2. Validate product & nursery availability for public storefront
    const isOwner = await isProductOwner(product.nursery, req.user);
    if (!isOwner && req.user?.role !== "admin") {
      if (
        product.isPublished !== true ||
        product.isActive !== true ||
        product.isNurseryActive !== true
      ) {
        return next(
          new ErrorHandler("Product not found or currently unavailable.", 404)
        );
      }

      if (!product.nursery) {
        return next(
          new ErrorHandler("Product not found or currently unavailable.", 404)
        );
      }

      const nurseryRef =
        typeof product.nursery === "object" && product.nursery._id
          ? product.nursery._id.toString()
          : product.nursery.toString();
      const isLive = await isNurseryLiveAndActive(nurseryRef);
      if (!isLive) {
        return next(
          new ErrorHandler("Product not found or currently unavailable.", 404)
        );
      }
    }

    // 3. Base candidate filter (strictly active nursery, published, active, in-stock)
    const activeNurseryIds = await getActiveNurseryIds();
    const activeObjectIds = activeNurseryIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const allActiveNurseryIds = [...activeNurseryIds, ...activeObjectIds];

    const baseCandidateFilter: any = {
      _id: { $ne: product._id },
      isPublished: true,
      isActive: true,
      isNurseryActive: true,
      stock: { $gt: 0 },
    };
    if (allActiveNurseryIds.length > 0) {
      baseCandidateFilter.nursery = { $in: allActiveNurseryIds };
    }

    const rawCat = product.category || "";
    const canonicalCat =
      normalizeCategorySlug(rawCat) || rawCat.toLowerCase().trim();
    const isArtificial =
      canonicalCat === "artificial-dried" ||
      canonicalCat === "artificial-dried-plants";

    // ------------------------------------------------------------------
    // 🛒 A. FREQUENTLY BOUGHT TOGETHER (CROSS-SELL COMPLEMENTARY PAIRS)
    // ------------------------------------------------------------------
    const affinityCategories =
      CROSS_SELL_AFFINITY_MATRIX[canonicalCat] || [
        "pots",
        "plant-care",
        "accessories",
        "plant-stands-shelves",
      ];

    const pickedCrossMap = new Map<string, any>();
    const pickedCategoryCounts = new Map<string, number>();

    // Pass 1: Fetch top 2 candidates per complementary category and pick 1 per category
    for (const cat of affinityCategories) {
      if (pickedCrossMap.size >= crossLimit) break;

      const catQuery = getCategoryDbQueryFilter(cat);
      const candidates = await Product.find({
        ...baseCandidateFilter,
        category: catQuery,
        _id: {
          $nin: [
            product._id,
            ...Array.from(pickedCrossMap.keys()).map(
              (id) => new mongoose.Types.ObjectId(id)
            ),
          ],
        },
      })
        .sort({ ratingsAverage: -1, sold: -1, createdAt: -1 })
        .limit(2)
        .populate(
          "nursery",
          "businessName slug businessAddress logo email phone isActive approvalStatus status isBlocked"
        )
        .lean();

      if (candidates.length > 0) {
        const primary = candidates[0];
        pickedCrossMap.set(primary._id.toString(), primary);
        pickedCategoryCounts.set(cat, (pickedCategoryCounts.get(cat) || 0) + 1);
      }
    }

    // Pass 2: If still fewer than crossLimit, backfill from affinity categories without exceeding
    if (pickedCrossMap.size < crossLimit) {
      for (const cat of affinityCategories) {
        if (pickedCrossMap.size >= crossLimit) break;
        const catQuery = getCategoryDbQueryFilter(cat);
        const moreCandidates = await Product.find({
          ...baseCandidateFilter,
          category: catQuery,
          _id: {
            $nin: [
              product._id,
              ...Array.from(pickedCrossMap.keys()).map(
                (id) => new mongoose.Types.ObjectId(id)
              ),
            ],
          },
        })
          .sort({ ratingsAverage: -1, sold: -1, createdAt: -1 })
          .limit(crossLimit - pickedCrossMap.size)
          .populate(
            "nursery",
            "businessName slug businessAddress logo email phone isActive approvalStatus status isBlocked"
          )
          .lean();

        for (const cand of moreCandidates) {
          if (pickedCrossMap.size >= crossLimit) break;
          pickedCrossMap.set(cand._id.toString(), cand);
        }
      }
    }

    // Pass 3 (Ultimate Fallback): Backfill from general active store items, respecting artificial exclusions
    if (pickedCrossMap.size < crossLimit) {
      const fallbackQuery: any = {
        ...baseCandidateFilter,
        _id: {
          $nin: [
            product._id,
            ...Array.from(pickedCrossMap.keys()).map(
              (id) => new mongoose.Types.ObjectId(id)
            ),
          ],
        },
      };
      if (isArtificial) {
        fallbackQuery.category = { $nin: ["plant-care", "seeds-bulbs"] };
      }
      const genericFallbacks = await Product.find(fallbackQuery)
        .sort({ ratingsAverage: -1, sold: -1, createdAt: -1 })
        .limit(crossLimit - pickedCrossMap.size)
        .populate(
          "nursery",
          "businessName slug businessAddress logo email phone isActive approvalStatus status isBlocked"
        )
        .lean();

      for (const cand of genericFallbacks) {
        if (pickedCrossMap.size >= crossLimit) break;
        pickedCrossMap.set(cand._id.toString(), cand);
      }
    }

    const frequentlyBoughtTogether = Array.from(pickedCrossMap.values());

    // ------------------------------------------------------------------
    // 🌿 B. SIMILAR COLLECTIONS YOU MAY LIKE (SAME-CATEGORY ALTERNATIVES)
    // ------------------------------------------------------------------
    const sameCategoryQuery = getCategoryDbQueryFilter(canonicalCat);
    const similarPool = await Product.find({
      ...baseCandidateFilter,
      category: sameCategoryQuery,
    })
      .limit(30)
      .populate(
        "nursery",
        "businessName slug businessAddress logo email phone isActive approvalStatus status isBlocked"
      )
      .lean();

    // Source features extraction
    const sourceAttrs = (product.attributes || {}) as Record<string, any>;
    const sourceSub = (
      sourceAttrs.subCategory ||
      sourceAttrs.plantType ||
      ""
    )
      .toString()
      .toLowerCase()
      .trim();
    const sourceMat = (sourceAttrs.material || "")
      .toString()
      .toLowerCase()
      .trim();
    const sourceLight = (sourceAttrs.lightRequirement || "")
      .toString()
      .toLowerCase()
      .trim();
    const sourceMaint = (sourceAttrs.maintenanceLevel || "")
      .toString()
      .toLowerCase()
      .trim();
    const sourceToolType = (sourceAttrs.toolType || "")
      .toString()
      .toLowerCase()
      .trim();
    const sourceForm = (sourceAttrs.formType || "")
      .toString()
      .toLowerCase()
      .trim();
    const sourceSeedType = (sourceAttrs.seedType || "")
      .toString()
      .toLowerCase()
      .trim();
    const sourcePrice = Number(product.price) || 0;
    const sourceTags = Array.isArray(product.tags)
      ? product.tags.map((t: string) => String(t).toLowerCase().trim())
      : [];

    // Intelligent relevance scoring
    const scoredSimilar = similarPool.map((cand: any) => {
      let score = 0;
      const candAttrs = (cand.attributes || {}) as Record<string, any>;
      const candSub = (
        candAttrs.subCategory ||
        candAttrs.plantType ||
        ""
      )
        .toString()
        .toLowerCase()
        .trim();
      const candMat = (candAttrs.material || "")
        .toString()
        .toLowerCase()
        .trim();
      const candLight = (candAttrs.lightRequirement || "")
        .toString()
        .toLowerCase()
        .trim();
      const candMaint = (candAttrs.maintenanceLevel || "")
        .toString()
        .toLowerCase()
        .trim();
      const candToolType = (candAttrs.toolType || "")
        .toString()
        .toLowerCase()
        .trim();
      const candForm = (candAttrs.formType || "")
        .toString()
        .toLowerCase()
        .trim();
      const candSeedType = (candAttrs.seedType || "")
        .toString()
        .toLowerCase()
        .trim();
      const candTags = Array.isArray(cand.tags)
        ? cand.tags.map((t: string) => String(t).toLowerCase().trim())
        : [];

      // 1. Subcategory / plantType match
      if (sourceSub && candSub && sourceSub === candSub) {
        score += 50;
      } else if (sourceSub && candTags.includes(sourceSub)) {
        score += 30;
      }

      // 2. Material match (pots, shelves, tools)
      if (sourceMat && candMat && sourceMat === candMat) {
        score += 25;
      }

      // 3. Category-specific attribute synergy
      if (sourceLight && candLight && sourceLight === candLight) score += 20;
      if (sourceMaint && candMaint && sourceMaint === candMaint) score += 15;
      if (sourceToolType && candToolType && sourceToolType === candToolType) score += 35;
      if (sourceForm && candForm && sourceForm === candForm) score += 30;
      if (sourceSeedType && candSeedType && sourceSeedType === candSeedType) score += 30;

      // 4. Price bracket proximity (±35%)
      if (sourcePrice > 0) {
        const candPrice = Number(cand.price) || 0;
        const diffRatio = Math.abs(candPrice - sourcePrice) / sourcePrice;
        if (diffRatio <= 0.35) {
          score += Math.round(25 * (1 - diffRatio));
        } else {
          score += Math.max(0, Math.round(10 * (1 - Math.min(diffRatio, 1))));
        }
      }

      // 5. Shared tags
      if (sourceTags.length > 0 && candTags.length > 0) {
        const commonTags = sourceTags.filter((t: string) => candTags.includes(t));
        score += commonTags.length * 10;
      }

      // 6. Rating & popularity bonus
      score += Math.round((cand.ratingsAverage || 4.5) * 2);
      score += Math.min(cand.sold || 0, 10);

      return { product: cand, score };
    });

    // Sort by relevance score descending
    scoredSimilar.sort((a, b) => b.score - a.score);

    let similarCollections = scoredSimilar.slice(0, limit).map((s) => s.product);

    // Fallback: If same category didn't have enough items to fulfill limit, backfill from other active catalog products
    if (similarCollections.length < limit) {
      const existingIds = [
        product._id,
        ...similarCollections.map((p) => p._id),
      ];
      const backfillQuery: any = {
        ...baseCandidateFilter,
        _id: { $nin: existingIds },
      };
      const generalBackfill = await Product.find(backfillQuery)
        .sort({ ratingsAverage: -1, sold: -1, createdAt: -1 })
        .limit(limit - similarCollections.length)
        .populate(
          "nursery",
          "businessName slug businessAddress logo email phone isActive approvalStatus status isBlocked"
        )
        .lean();

      similarCollections = [...similarCollections, ...generalBackfill];
    }

    res.status(200).json({
      success: true,
      sourceProduct: {
        id: product._id,
        name: product.name,
        category: product.category,
        slug: product.slug,
      },
      frequentlyBoughtTogether,
      similarCollections,
    });
  }
);

/**
 * ✏️ UPDATE PRODUCT
 * PUT /api/v1/products/:id
 */
export const updateProduct = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const user = req.user;

    if (!user) return next(new ErrorHandler("Unauthorized", 401));

    let product = await Product.findById(id);
    if (!product) return next(new ErrorHandler("Product not found.", 404));

    // Strict Ownership verification: Only super-admin or product's nursery vendor can update
    const isOwner = await isProductOwner(product.nursery, user);
    if (!isOwner) {
      return next(new ErrorHandler("You do not have permission to modify this product.", 403));
    }

    const payload = extractProductPayload(req.body);
    const {
      name,
      category,
      price,
      discountPrice,
      stock,
      description,
      descriptionOption,
      isPublished,
      metaTitle,
      metaDescription,
      tags,
      attributes,
      updateSlug,
    } = payload;

    if (name) product.name = name;
    if (category && PRODUCT_CATEGORIES.includes(category)) product.category = category;
    if (price !== undefined) product.price = Number(price);
    if (discountPrice !== undefined) product.discountPrice = Number(discountPrice);
    if (stock !== undefined) product.stock = Number(stock);
    if (description) product.description = description;
    if (descriptionOption) {
      product.descriptionOption =
        typeof descriptionOption === "string" ? JSON.parse(descriptionOption) : descriptionOption;
    }
    if (isPublished !== undefined) product.isPublished = Boolean(isPublished);
    if (metaTitle !== undefined) product.metaTitle = metaTitle;
    if (metaDescription !== undefined) product.metaDescription = metaDescription;
    if (tags) {
      product.tags = typeof tags === "string" ? tags.split(",").map((t: string) => t.trim()) : tags;
    }

    if (attributes) {
      try {
        const validated = validateCategoryAttributes(product.category, attributes);
        product.attributes = { ...product.attributes, ...validated };
        product.markModified("attributes");
      } catch (err: any) {
        return next(new ErrorHandler(`Invalid attributes: ${err.message}`, 400));
      }
    }

    // 🖼️ 1. Retain existing images if passed (handles user deletions from gallery in edit mode)
    if (req.body.existingImages) {
      try {
        const existingImagesParsed =
          typeof req.body.existingImages === "string"
            ? JSON.parse(req.body.existingImages)
            : req.body.existingImages;
        if (Array.isArray(existingImagesParsed)) {
          product.images = existingImagesParsed;
        }
      } catch (e) {
        console.warn("⚠️ Failed to parse existingImages:", e);
      }
    }

    // 🗑️ 2. Delete removed images from Cloudinary and product.images
    if (req.body.deletedImagePublicIds) {
      try {
        const deletedIds =
          typeof req.body.deletedImagePublicIds === "string"
            ? JSON.parse(req.body.deletedImagePublicIds)
            : req.body.deletedImagePublicIds;
        if (Array.isArray(deletedIds) && deletedIds.length > 0) {
          product.images = product.images.filter(
            (img: any) => !deletedIds.includes(img.public_id)
          );
          // Delete from Cloudinary in background (non-blocking)
          Promise.allSettled(
            deletedIds.map((pid: string) => deleteFromCloudinary(pid))
          ).catch((err) => console.warn("Cloudinary cleanup error:", err));
        }
      } catch (e) {
        console.warn("⚠️ Failed to parse deletedImagePublicIds:", e);
      }
    }

    // Process new uploaded images
    if (req.files) {
      const filesObj = req.files;

      if (filesObj.coverImage) {
        const coverFile = Array.isArray(filesObj.coverImage) ? filesObj.coverImage[0] : filesObj.coverImage;
        const upload = await uploadToCloudinary(coverFile, `urban-nursery/products/${product.category}/cover`);
        product.coverImage = { url: upload.url, public_id: upload.publicId };
        if (!product.images.some((img: any) => img.public_id === upload.publicId)) {
          product.images.unshift(product.coverImage);
        }
      }

      const fileList: UploadedFile[] = [];
      for (const key of Object.keys(filesObj)) {
        if (key === "coverImage") continue;
        const item = filesObj[key];
        if (Array.isArray(item)) {
          fileList.push(...item);
        } else {
          fileList.push(item);
        }
      }

      for (const file of fileList) {
        const upload = await uploadToCloudinary(file, `urban-nursery/products/${product.category}`);
        product.images.push({
          url: upload.url,
          public_id: upload.publicId,
        });
      }
    }

    // Guarantee valid coverImage
    if (!product.coverImage || !product.coverImage.url) {
      if (product.images.length > 0) {
        product.coverImage = product.images[0];
      }
    }

    // If updateSlug flag passed explicitly, let the pre-save hook refresh slug
    if (updateSlug === true || updateSlug === "true") {
      (product as any)._updateSlug = true;
    }

    // Ensure isNurseryActive is strictly in sync with nursery vendor live status
    product.isNurseryActive = await isNurseryLiveAndActive(product.nursery);

    await product.save();

    await cacheManager.invalidatePattern("catalog:");
    await cacheManager.invalidatePattern("products:");

    res.status(200).json({
      success: true,
      message: "Product updated successfully.",
      product,
      plant: product,
      pot: product,
      accessory: product,
      gardeningTool: product,
      plantCare: product,
      seedsBulbs: product,
      plantStandsShelves: product,
      stand: product,
      artificial: product,
      artificialDriedPlant: product,
    });
  }
);

/**
 * 🗑️ DELETE PRODUCT
 * DELETE /api/v1/products/:id
 */
export const deleteProduct = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const user = req.user;

    if (!user) return next(new ErrorHandler("Unauthorized", 401));

    const product = await Product.findById(id);
    if (!product) return next(new ErrorHandler("Product not found.", 404));

    // Ownership check
    const isOwner = await isProductOwner(product.nursery, user);
    if (!isOwner) {
      return next(new ErrorHandler("You do not have permission to delete this product.", 403));
    }

    // Cleanup images from Cloudinary asynchronously
    if (product.images && product.images.length > 0) {
      for (const img of product.images) {
        if (img.public_id) {
          deleteFromCloudinary(img.public_id).catch(() => {});
        }
      }
    }

    await product.deleteOne();

    await cacheManager.invalidatePattern("catalog:");
    await cacheManager.invalidatePattern("products:");

    res.status(200).json({
      success: true,
      message: "Product deleted successfully.",
    });
  }
);

/**
 * 🏡 GET NURSERY PRODUCTS (VENDOR STOREFRONT / DASHBOARD INVENTORY)
 * GET /api/v1/products/nursery/:nurseryId
 */
export const getNurseryProducts = catchAsyncErrors(
  async (req: Request, res: Response, _next: NextFunction) => {
    const rawNurseryId = req.params.nurseryId;
    const nurseryId = String(Array.isArray(rawNurseryId) ? rawNurseryId[0] : rawNurseryId).trim();
    const isOwner = req.user && (req.user._id.toString() === nurseryId || req.user.role === "admin");

    const relatedProfile = await NurseryProfile.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(nurseryId) ? nurseryId : null },
        { nursery: mongoose.isValidObjectId(nurseryId) ? nurseryId : null },
        { slug: nurseryId },
      ],
    })
      .select("_id nursery")
      .lean();

    const nurseryIds: string[] = relatedProfile
      ? [relatedProfile._id.toString(), relatedProfile.nursery ? relatedProfile.nursery.toString() : ""].filter(Boolean)
      : [nurseryId];

    const filter: any = { nursery: { $in: nurseryIds } };
    if (!isOwner && req.user?.role !== "admin") {
      const activeNurseryIds = await getActiveNurseryIds();
      const hasActive = nurseryIds.some((id) => activeNurseryIds.includes(id));
      if (!hasActive) {
        res.status(200).json({
          success: true,
          count: 0,
          products: [],
        });
        return;
      }
      filter.isPublished = true;
      filter.isActive = true;
      filter.isNurseryActive = true;
    }

    const products = await Product.find(filter).sort("-createdAt").lean();

    res.status(200).json({
      success: true,
      count: products.length,
      products,
    });
  }
);

/**
 * 🌿 GET MY NURSERY PRODUCTS (AUTHENTICATED VENDOR INVENTORY)
 * GET /api/v1/products/vendor/my-products
 */
export const getMyNurseryProducts = catchAsyncErrors(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?._id;
    if (!userId) {
      res.status(200).json({ success: true, count: 0, products: [] });
      return;
    }

    const profile = await NurseryProfile.findOne({ nursery: userId }).select("_id").lean();
    const nurseryIds = [userId.toString(), profile?._id ? profile._id.toString() : ""].filter(Boolean);

    const { category } = req.query;
    const filter: any = { nursery: { $in: nurseryIds } };
    if (category) {
      const norm = normalizeCategory(category);
      if (norm) {
        if (
          norm === "plant-stands-shelves" ||
          norm === "stands-shelves" ||
          (norm as string) === "plant-stands-and-shelves"
        ) {
          filter.category = {
            $in: ["plant-stands-shelves", "stands-shelves", "plant-stands-and-shelves"],
          };
        } else if (norm === "artificial-dried" || (norm as string) === "artificial-dried-plants") {
          filter.category = { $in: ["artificial-dried", "artificial-dried-plants"] };
        } else if (norm === "pots" || (norm as string) === "pots-planters") {
          filter.category = { $in: ["pots", "pots-planters"] };
        } else {
          filter.category = norm;
        }
      }
    }

    const products = await Product.find(filter).sort("-createdAt").lean();

    res.status(200).json({
      success: true,
      count: products.length,
      products,
      plants: products.filter((p) => p.category === "plants"),
      pots: products.filter((p) => p.category === "pots" || p.category === "pots-planters"),
      accessories: products.filter((p) => p.category === "accessories"),
      gardeningTools: products.filter((p) => p.category === "gardening-tools"),
      plantCare: products.filter((p) => p.category === "plant-care"),
      seedsBulbs: products.filter((p) => p.category === "seeds-bulbs"),
      plantStandsShelves: products.filter(
        (p) =>
          p.category === "plant-stands-shelves" ||
          p.category === "stands-shelves" ||
          p.category === "plant-stands-and-shelves"
      ),
      artificials: products.filter(
        (p) => p.category === "artificial-dried" || p.category === "artificial-dried-plants"
      ),
    });
  }
);

/**
 * 🧮 Authoritative review ratings recalculator (ignores rejected reviews)
 */
export const recalculateProductRatings = (product: IProduct): void => {
  const activeReviews = (product.reviews || []).filter(
    (r) => (r.status || "approved") !== "rejected"
  );
  product.ratingsQuantity = activeReviews.length;
  product.numOfReviews = activeReviews.length;
  if (activeReviews.length === 0) {
    product.ratingsAverage = 0;
    product.ratings = 0;
  } else {
    const totalRating = activeReviews.reduce((acc, item) => acc + (item.rating || 0), 0);
    product.ratingsAverage = Math.round((totalRating / activeReviews.length) * 10) / 10;
    product.ratings = product.ratingsAverage;
  }
};

/**
 * ⭐ CREATE PRODUCT REVIEW WITH VERIFIED BUYER ENFORCEMENT
 * POST /api/v1/products/:id/review
 */
export const createProductReview = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { rating, comment } = req.body;
    const user = req.user;

    if (!user) return next(new ErrorHandler("Unauthorized", 401));
    if (!rating || !comment) return next(new ErrorHandler("Rating and comment are required.", 400));

    const numericRating = Number(rating);
    if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
      return next(new ErrorHandler("Rating must be a number between 1 and 5.", 400));
    }

    const productIdRaw = req.params.id || req.body.productId;
    if (!productIdRaw || !mongoose.Types.ObjectId.isValid(productIdRaw)) {
      return next(new ErrorHandler("Invalid product ID.", 400));
    }

    const product = await Product.findById(productIdRaw);
    if (!product) return next(new ErrorHandler("Product not found.", 404));

    const userObjectId = new mongoose.Types.ObjectId(String(user._id));
    const productObjectId = new mongoose.Types.ObjectId(String(product._id));

    // 🔒 1. Duplicate Review Prevention: Check if user already submitted a review
    const hasAlreadyReviewed = product.reviews.some(
      (r) => r.user && r.user.toString() === userObjectId.toString()
    );

    if (hasAlreadyReviewed) {
      return next(
        new ErrorHandler("You have already submitted a review for this product", 400)
      );
    }

    // 🔒 2. Order History & Delivery Check:
    // Only grant verified status if user has an order with status 'Delivered' containing this product (not cancelled).
    const hasDeliveredOrder = await Order.exists({
      user: userObjectId,
      orderStatus: "Delivered",
      orderItems: {
        $elemMatch: {
          item: productObjectId,
          status: { $ne: "Cancelled" },
        },
      },
    });

    const isVerifiedBuyer = Boolean(hasDeliveredOrder);

    // Business policy: if strict verified-only mode is configured, reject non-purchasers with 403
    if (process.env.REQUIRE_VERIFIED_PURCHASE_FOR_REVIEW === "true" && !isVerifiedBuyer) {
      return next(
        new ErrorHandler(
          "Only verified buyers who have received this product can submit a review.",
          403
        )
      );
    }

    product.reviews.push({
      user: userObjectId,
      name: (user.name || "Customer").trim(),
      rating: numericRating,
      comment: String(comment).trim(),
      isVerifiedBuyer,
      status: "approved",
    });

    // 🔒 3. Rating & Aggregation Recalculation (atomic rounding to 1 decimal place)
    recalculateProductRatings(product);

    await product.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: "Review recorded successfully.",
      ratingsAverage: product.ratingsAverage,
      ratingsQuantity: product.ratingsQuantity,
      isVerifiedBuyer,
    });
  }
);

/**
 * 🗑️ DELETE PRODUCT REVIEW
 * DELETE /api/v1/products/:id/review/:reviewId
 */
export const deleteProductReview = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id, reviewId } = req.params;
    const user = req.user;

    if (!user) return next(new ErrorHandler("Unauthorized", 401));

    const product = await Product.findById(id);
    if (!product) return next(new ErrorHandler("Product not found.", 404));

    const reviewIndex = product.reviews.findIndex(
      (r) => r._id?.toString() === reviewId
    );

    if (reviewIndex === -1) {
      return next(new ErrorHandler("Review not found.", 404));
    }

    const review = product.reviews[reviewIndex];
    if (
      user.role !== "admin" &&
      review.user?.toString() !== user._id.toString()
    ) {
      return next(new ErrorHandler("Not authorized to delete this review.", 403));
    }

    product.reviews.splice(reviewIndex, 1);
    recalculateProductRatings(product);

    await product.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: "Review deleted successfully.",
      ratingsAverage: product.ratingsAverage,
      ratingsQuantity: product.ratingsQuantity,
    });
  }
);

/**
 * 🔄 TOGGLE PRODUCT STATUS (ADMIN / VENDOR)
 * PUT /api/v1/products/:id/toggle-status
 */
export const toggleProductStatus = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const user = req.user;

    const product = await Product.findById(id);
    if (!product) return next(new ErrorHandler("Product not found.", 404));

    const isOwner = await isProductOwner(product.nursery, user);
    if (!isOwner) {
      return next(new ErrorHandler("Forbidden.", 403));
    }

    product.isPublished = !product.isPublished;
    product.isActive = product.isPublished;
    await product.save({ validateBeforeSave: false });

    await cacheManager.invalidatePattern("catalog:");
    await cacheManager.invalidatePattern("products:");

    res.status(200).json({
      success: true,
      message: `Product is now ${product.isPublished ? "Active" : "Inactive"}.`,
      isPublished: product.isPublished,
      isActive: product.isActive,
    });
  }
);
