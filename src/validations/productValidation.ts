import { z } from "zod";
import { Request, Response, NextFunction } from "express";
import ErrorHandler from "../utils/errorHandler";

// Helper to safely parse strings or arrays from FormData
const stringToArray = z.preprocess((val) => {
  if (Array.isArray(val)) {
    return val.map((s) => (typeof s === "string" ? s.trim() : s)).filter(Boolean);
  }
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        return parsed.map((s) => (typeof s === "string" ? s.trim() : s)).filter(Boolean);
      }
    } catch {
      return val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}, z.array(z.string().trim()).min(1, "At least one entry is required"));

// Helper for optional string to array
const optionalStringToArray = z.preprocess((val) => {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.map((s) => (typeof s === "string" ? s.trim() : s)).filter(Boolean);
  }
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        return parsed.map((s) => (typeof s === "string" ? s.trim() : s)).filter(Boolean);
      }
    } catch {
      return val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}, z.array(z.string().trim()).optional());

// Common Description Option Schema
export const descriptionOptionSchema = z.preprocess(
  (val) => {
    if (typeof val === "string") {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return val;
  },
  z.object({
    short: z.string().trim().min(1, "Please enter short description"),
    points: stringToArray,
  })
);

// Base Product Schema with Standardized Fields
const baseProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  description: z.string().trim().min(1, "Product description is required"),
  descriptionOption: descriptionOptionSchema,
  price: z.coerce.number().positive("Price must be greater than 0"),
  discountPrice: z.coerce.number().min(0, "Discount price cannot be negative").optional().default(0),
  category: z.string().trim().min(1, "Category is required"),
  stock: z.coerce.number().min(0, "Stock cannot be negative").default(1),
  metaTitle: z.string().trim().optional(),
  metaDescription: z.string().trim().optional(),
  existingImages: z.any().optional(),
  existingGalleryImages: z.any().optional(),
  retainedImages: z.any().optional(),
  deletedImagePublicIds: z.any().optional(),
  deletedPublicIds: z.any().optional(),
  images: z.any().optional(),
  galleryImages: z.any().optional(),
});

// ─────────────────────────────────────────────────────────────
// 1. Plant Schema: Broaden Light, Watering & Maintenance
// ─────────────────────────────────────────────────────────────
export const plantValidationSchema = baseProductSchema.extend({
  benefits: stringToArray,
  careInstructions: stringToArray,
  lightRequirement: z.preprocess(
    (val) => String(val || "").trim(),
    z.string().min(1, "Light requirement is required")
  ),
  wateringSchedule: z.preprocess(
    (val) => String(val || "").trim(),
    z.string().min(1, "Watering schedule is required")
  ),
  maintenanceLevel: z.preprocess(
    (val) => String(val || "Easy").trim(),
    z.string().optional().default("Easy")
  ),
  isPetFriendly: z.preprocess((val) => val === "true" || val === true, z.boolean().default(true)),
});

// ─────────────────────────────────────────────────────────────
// 2. Pot Schema: Material, Dimensions, Shape, Placement
// ─────────────────────────────────────────────────────────────
export const potValidationSchema = baseProductSchema.extend({
  material: z.string().trim().min(1, "Pot material is required"),
  color: stringToArray,
  dimensions: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch {
          return val;
        }
      }
      return val;
    },
    z.object({
      height: z.string().trim().min(1, "Pot height is required"),
      diameter: z.string().trim().min(1, "Pot diameter is required"),
      width: z.string().trim().optional(),
      length: z.string().trim().optional(),
    })
  ),
  hasDrainageHole: z.preprocess((val) => val === "true" || val === true, z.boolean().default(true)),
  shape: z.preprocess(
    (val) => String(val || "Round").trim(),
    z.string().min(1, "Shape is required")
  ),
  isIndoorOutdoor: z.preprocess(
    (val) => String(val || "Both").trim(),
    z.string().default("Both")
  ),
  includesSaucer: z.preprocess((val) => val === "true" || val === true, z.boolean().default(false)),
});

// ─────────────────────────────────────────────────────────────
// 3. Accessory Schema: Flexible Specifications
// ─────────────────────────────────────────────────────────────
export const accessoryValidationSchema = baseProductSchema.extend({
  specifications: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch {
          return {};
        }
      }
      return val || {};
    },
    z
      .object({
        brand: z.string().trim().optional(),
        weight: z.string().trim().optional(),
        material: z.string().trim().optional(),
        capacity: z.string().trim().optional(),
        dimensions: z.string().trim().optional(),
      })
      .optional()
      .default({})
  ),
});

// ─────────────────────────────────────────────────────────────
// 4. Artificial / Dried Plant Schema
// ─────────────────────────────────────────────────────────────
export const artificialDriedPlantValidationSchema = baseProductSchema.extend({
  specifications: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch {
          return {};
        }
      }
      return val || {};
    },
    z
      .object({
        brand: z.string().trim().optional(),
        material: z.string().trim().optional(),
        height: z.string().trim().optional(),
        color: z.string().trim().optional(),
        washable: z.preprocess((v) => v === "true" || v === true, z.boolean().optional()),
        potIncluded: z.preprocess((v) => v === "true" || v === true, z.boolean().optional()),
      })
      .optional()
      .default({})
  ),
});

// ─────────────────────────────────────────────────────────────
// 5. Gardening Tool Schema
// ─────────────────────────────────────────────────────────────
export const gardeningToolValidationSchema = baseProductSchema.extend({
  features: stringToArray,
  material: z.string().trim().optional(),
  handleMaterial: z.string().trim().optional(),
  warrantyMonths: z.preprocess((val) => (val ? Number(val) : 0), z.number().optional().default(0)),
});

// ─────────────────────────────────────────────────────────────
// 6. Plant Care & Fertilizers Schema
// ─────────────────────────────────────────────────────────────
export const plantCareValidationSchema = baseProductSchema.extend({
  howToUse: stringToArray,
  composition: z.string().trim().optional(),
  volumeOrWeight: z.string().trim().optional(),
  formType: z.string().trim().optional(),
  isOrganic: z.preprocess((val) => val === "true" || val === true, z.boolean().default(true)),
});

// ─────────────────────────────────────────────────────────────
// 7. Plant Stands & Shelves Schema
// ─────────────────────────────────────────────────────────────
export const plantStandsShelvesValidationSchema = baseProductSchema.extend({
  material: z.string().trim().min(1, "Material is required"),
  dimensions: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch {
          return {};
        }
      }
      return val || {};
    },
    z
      .object({
        height: z.string().trim().optional(),
        width: z.string().trim().optional(),
        length: z.string().trim().optional(),
      })
      .optional()
      .default({})
  ),
  tierCount: z.preprocess((val) => (val ? Number(val) : 1), z.number().min(1).default(1)),
  maxLoadCapacity: z.preprocess(
    (val) => (val !== undefined && val !== null ? String(val).trim() : undefined),
    z.string().trim().optional()
  ),
});

// ─────────────────────────────────────────────────────────────
// 8. Seeds & Bulbs Schema
// ─────────────────────────────────────────────────────────────
export const seedsBulbsValidationSchema = baseProductSchema.extend({
  sowingSeason: stringToArray,
  germinationTime: z.string().trim().optional(),
  quantityPerPack: z.string().trim().min(1, "Pack quantity is required"),
});

// Helper validation middleware for Express routes
export const validateProductBody = (schema: z.ZodTypeAny, payloadKey?: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    let body = req.body || {};

    if (payloadKey && body[payloadKey] && typeof body[payloadKey] === "string") {
      try {
        body = { ...body, ...JSON.parse(body[payloadKey]) };
      } catch {
        return next(new ErrorHandler(`Invalid JSON format in ${payloadKey}`, 400));
      }
    }

    // Try parsing nested JSON string fields if passed in FormData
    [
      "descriptionOption",
      "dimensions",
      "specifications",
      "color",
      "benefits",
      "careInstructions",
      "features",
      "howToUse",
      "sowingSeason",
    ].forEach((field) => {
      if (
        body[field] &&
        typeof body[field] === "string" &&
        (body[field].startsWith("{") || body[field].startsWith("["))
      ) {
        try {
          body[field] = JSON.parse(body[field]);
        } catch {
          /* keep string */
        }
      }
    });

    const isUpdate = req.method === "PUT" || req.method === "PATCH";
    const baseSchema =
      isUpdate && typeof (schema as any).partial === "function"
        ? (schema as any).partial()
        : schema;

    const validationSchema = baseSchema.superRefine((data: any, ctx: z.RefinementCtx) => {
      if (
        data.discountPrice !== undefined &&
        data.discountPrice !== null &&
        Number(data.discountPrice) > 0
      ) {
        if (data.price !== undefined && data.price !== null) {
          if (Number(data.discountPrice) >= Number(data.price)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Discount price must be strictly less than original price",
              path: ["discountPrice"],
            });
          }
        }
      }
    });

    const result = validationSchema.safeParse(body);
    if (!result.success) {
      const errorDetails = (result.error.issues || [])
        .map((e: any) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      return next(new ErrorHandler(`Validation Failed: ${errorDetails}`, 400));
    }

    // Attach validated data
    req.body = { ...req.body, ...result.data };
    if (body.existingImages !== undefined) req.body.existingImages = body.existingImages;
    if (body.existingGalleryImages !== undefined) req.body.existingGalleryImages = body.existingGalleryImages;
    if (body.retainedImages !== undefined) req.body.retainedImages = body.retainedImages;
    if (body.deletedImagePublicIds !== undefined) req.body.deletedImagePublicIds = body.deletedImagePublicIds;
    if (body.deletedPublicIds !== undefined) req.body.deletedPublicIds = body.deletedPublicIds;
    next();
  };
};
