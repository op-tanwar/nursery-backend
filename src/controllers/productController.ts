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
import { getActiveNurseryIds, ACTIVE_NURSERIES_CACHE_KEY } from "./cartController";
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
  isPetFriendly: z.boolean().optional(),
  benefits: z.array(z.string()).optional(),
  careInstructions: z.array(z.string()).optional(),
  plantType: z.string().optional(),
}).passthrough();

export const potAttributesSchema = z.object({
  material: z.string().optional(),
  color: z.union([z.string(), z.array(z.string())]).optional(),
  dimensions: z.object({
    height: z.string().optional(),
    diameter: z.string().optional(),
    width: z.string().optional(),
    length: z.string().optional(),
  }).optional(),
  drainageHoles: z.boolean().optional(),
  hasDrainageHole: z.boolean().optional(),
  shape: z.string().optional(),
  isIndoorOutdoor: z.string().optional(),
  includesSaucer: z.boolean().optional(),
}).passthrough();

export const accessoryAttributesSchema = z.object({
  material: z.string().optional(),
  brand: z.string().optional(),
  weight: z.string().optional(),
  capacity: z.string().optional(),
  usageType: z.string().optional(),
}).passthrough();

export const gardeningToolAttributesSchema = z.object({
  features: z.array(z.string()).optional(),
  material: z.string().optional(),
  handleMaterial: z.string().optional(),
  warrantyMonths: z.number().optional(),
  toolType: z.string().optional(),
}).passthrough();

export const plantCareAttributesSchema = z.object({
  composition: z.string().optional(),
  howToUse: z.array(z.string()).optional(),
  volumeOrWeight: z.string().optional(),
  formType: z.string().optional(),
  suitableFor: z.array(z.string()).optional(),
}).passthrough();

export const seedsBulbsAttributesSchema = z.object({
  sowingSeason: z.union([z.string(), z.array(z.string())]).optional(),
  germinationTime: z.union([z.string(), z.number()]).optional(),
  germinationDays: z.union([z.string(), z.number()]).optional(),
  quantityPerPack: z.string().optional(),
  sunlightRequirement: z.string().optional(),
  seedType: z.string().optional(),
}).passthrough();

export const standsShelvesAttributesSchema = z.object({
  material: z.string().optional(),
  dimensions: z.object({
    height: z.string().optional(),
    width: z.string().optional(),
    length: z.string().optional(),
  }).optional(),
  tierCount: z.number().optional(),
  maxLoadCapacity: z.string().optional(),
  isFoldable: z.boolean().optional(),
}).passthrough();

export const artificialDriedAttributesSchema = z.object({
  material: z.string().optional(),
  height: z.string().optional(),
  color: z.string().optional(),
  brand: z.string().optional(),
  includesVase: z.boolean().optional(),
  potIncluded: z.boolean().optional(),
  washable: z.boolean().optional(),
}).passthrough();

export const validateCategoryAttributes = (
  category: ProductCategory,
  attributes: any
): Record<string, any> => {
  if (!attributes) return {};
  const parsedAttr = typeof attributes === "string" ? JSON.parse(attributes) : attributes;

  switch (category) {
    case "plants":
      return plantAttributesSchema.parse(parsedAttr);
    case "pots":
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
    case "stands-shelves":
      return standsShelvesAttributesSchema.parse(parsedAttr);
    case "artificial-dried":
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
  plantCareData: "plant-care",
  seedsBulbsData: "seeds-bulbs",
  plantStandsShelvesData: "plant-stands-shelves",
  artificialDriedPlantData: "artificial-dried",
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

const extractProductPayload = (body: any) => {
  const payloadKeys = [
    "productData",
    "plantData",
    "potData",
    "accessoryData",
    "gardeningToolData",
    "plantCareData",
    "seedsBulbsData",
    "plantStandsShelvesData",
    "artificialDriedPlantData",
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

  // Gather any non-common top-level fields into baseAttrs
  for (const [k, v] of Object.entries(extracted)) {
    if (
      !COMMON_PRODUCT_KEYS.has(k) &&
      !payloadKeys.includes(k) &&
      k !== "attributes" &&
      k !== "subCategory"
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

    // Resolve target nursery ID:
    let nurseryId: any = null;
    if (user.role === "admin" && requestedNursery) {
      nurseryId = requestedNursery;
    } else {
      // Find nursery profile belonging to the authenticated user
      const profile = await NurseryProfile.findOne({ nursery: user._id });
      nurseryId = profile ? profile._id : user._id;
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
      discountPrice: discountPrice !== undefined ? Number(discountPrice) : 0,
      stock: Number(stock),
      description,
      descriptionOption: typeof descriptionOption === "string" ? JSON.parse(descriptionOption) : descriptionOption,
      isPublished: isPublished !== undefined ? Boolean(isPublished) : true,
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
      artificial: product,
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
    if (isPublished !== undefined) {
      baseFilter.isPublished = String(isPublished) === "true";
    } else if (req.user?.role !== "admin") {
      baseFilter.isPublished = { $ne: false };
      baseFilter.isActive = { $ne: false };
    }

    const normCategory = normalizeCategory(category);
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

    // Vendor / Nursery filter
    const targetNursery = nursery || vendor;
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
        baseFilter.nursery = { $in: nurseryIds };
      } else {
        baseFilter.nursery = targetNursery;
      }
    } else if (req.user?.role !== "admin") {
      // Filter out products from inactive / suspended nurseries using fast Redis cache
      const activeNurseryIds = await getActiveNurseryIds();
      if (activeNurseryIds && activeNurseryIds.length > 0) {
        baseFilter.nursery = { $in: activeNurseryIds };
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
            const geoOrCondition = [
              { shippingType: "NATIONAL_COURIER" },
              { nursery: { $in: Array.from(serviceableNurseryIds) } },
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
        .populate("nursery", "businessName slug businessAddress.city logo")
        .select("-__v")
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      totalCount,
      filteredCount,
      resultsPerPage,
      count: rawProducts.length,
      products: rawProducts,
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
        .populate("nursery", "businessName slug businessAddress logo email phone")
        .lean();
    }

    // 2. Direct Slug lookup
    if (!product) {
      product = await Product.findOne({ slug: param.toLowerCase() })
        .populate("nursery", "businessName slug businessAddress logo email phone")
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
          .populate("nursery", "businessName slug businessAddress logo email phone")
          .lean();
      }

      if (!product) {
        return next(new ErrorHandler("Product not found.", 404));
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

    // Process new uploaded images
    if (req.files) {
      const filesObj = req.files;

      if (filesObj.coverImage) {
        const coverFile = Array.isArray(filesObj.coverImage) ? filesObj.coverImage[0] : filesObj.coverImage;
        const upload = await uploadToCloudinary(coverFile, `urban-nursery/products/${product.category}/cover`);
        product.coverImage = { url: upload.url, public_id: upload.publicId };
        product.images.unshift(product.coverImage);
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

      if (!product.coverImage || !product.coverImage.url) {
        product.coverImage = product.images[0];
      }
    }

    // If updateSlug flag passed explicitly, let the pre-save hook refresh slug
    if (updateSlug === true || updateSlug === "true") {
      (product as any)._updateSlug = true;
    }

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
      artificial: product,
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
    const { nurseryId } = req.params;
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

    const nurseryIds = relatedProfile
      ? [relatedProfile._id.toString(), relatedProfile.nursery ? relatedProfile.nursery.toString() : ""].filter(Boolean)
      : [nurseryId];

    const filter: any = { nursery: { $in: nurseryIds } };
    if (!isOwner) {
      filter.isPublished = { $ne: false };
      filter.isActive = { $ne: false };
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
        if (norm === "plant-stands-shelves" || norm === "stands-shelves") {
          filter.category = { $in: ["plant-stands-shelves", "stands-shelves"] };
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
      pots: products.filter((p) => p.category === "pots"),
      accessories: products.filter((p) => p.category === "accessories"),
      gardeningTools: products.filter((p) => p.category === "gardening-tools"),
      plantCare: products.filter((p) => p.category === "plant-care"),
      seedsBulbs: products.filter((p) => p.category === "seeds-bulbs"),
      plantStandsShelves: products.filter((p) => p.category === "plant-stands-shelves" || p.category === "stands-shelves"),
      artificials: products.filter((p) => p.category === "artificial-dried"),
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
