import { z } from "zod";
import { Request, Response, NextFunction } from "express";
import ErrorHandler from "../utils/errorHandler";

// Common Description Option Schema
export const descriptionOptionSchema = z.object({
  short: z.string().trim().min(1, "Please enter short description"),
  points: z
    .array(z.string().trim())
    .min(1, "At least one highlight point is required")
    .refine((items) => items.some((item) => item.length > 0), {
      message: "At least one non-empty highlight point is required",
    }),
});

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
});

// 1. Plant Schema
export const plantValidationSchema = baseProductSchema.extend({
  benefits: z.array(z.string().trim()).min(1, "At least one plant benefit is required"),
  careInstructions: z.array(z.string().trim()).min(1, "At least one care instruction is required"),
  lightRequirement: z.enum(["Direct Sunlight", "Indirect Light", "Low Light"]),
  wateringSchedule: z.enum(["Everyday", "Alternate Days", "Once a Week", "When Dry"]),
  maintenanceLevel: z.enum(["Easy", "Moderate", "High"]).optional().default("Easy"),
  isPetFriendly: z.coerce.boolean().optional().default(true),
});

// 2. Pot Schema
export const potValidationSchema = baseProductSchema.extend({
  material: z.string().trim().min(1, "Pot material is required"),
  color: z.array(z.string().trim()).min(1, "At least one color is required"),
  dimensions: z.object({
    height: z.string().trim().min(1, "Pot height is required"),
    diameter: z.string().trim().min(1, "Pot diameter is required"),
  }),
  hasDrainageHole: z.coerce.boolean().optional().default(true),
  shape: z.enum(["Round", "Square", "Rectangular", "Hexagonal", "Oval", "Custom"]),
  isIndoorOutdoor: z.enum(["Indoor Only", "Outdoor Only", "Both"]).optional().default("Both"),
  includesSaucer: z.coerce.boolean().optional().default(false),
});

// 3. Accessory Schema
export const accessoryValidationSchema = baseProductSchema.extend({
  specifications: z.object({
    brand: z.string().trim().optional(),
    weight: z.string().trim().optional(),
    material: z.string().trim().optional(),
    capacity: z.string().trim().optional(),
    dimensions: z.string().trim().optional(),
  }).optional(),
});

// 4. Artificial / Dried Plant Schema
export const artificialDriedPlantValidationSchema = baseProductSchema.extend({
  specifications: z.object({
    brand: z.string().trim().optional(),
    material: z.string().trim().optional(),
    height: z.string().trim().optional(),
    color: z.string().trim().optional(),
    washable: z.coerce.boolean().optional(),
    potIncluded: z.coerce.boolean().optional(),
  }).optional(),
});

// 5. Gardening Tool Schema
export const gardeningToolValidationSchema = baseProductSchema.extend({
  features: z.array(z.string().trim()).min(1, "At least one feature is required"),
  material: z.string().trim().optional(),
  handleMaterial: z.string().trim().optional(),
  warrantyMonths: z.coerce.number().optional(),
});

// 6. Plant Care Schema
export const plantCareValidationSchema = baseProductSchema.extend({
  howToUse: z.array(z.string().trim()).min(1, "At least one usage instruction is required"),
  composition: z.string().trim().optional(),
  volumeOrWeight: z.string().trim().optional(),
  formType: z.string().trim().optional(),
  isOrganic: z.coerce.boolean().optional(),
});

// 7. Plant Stands & Shelves Schema
export const plantStandsShelvesValidationSchema = baseProductSchema.extend({
  material: z.string().trim().min(1, "Material is required"),
  dimensions: z.object({
    height: z.string().trim().optional(),
    width: z.string().trim().optional(),
    length: z.string().trim().optional(),
  }).optional(),
  tierCount: z.coerce.number().min(1).optional().default(1),
  maxLoadCapacity: z.string().trim().optional(),
});

// 8. Seeds & Bulbs Schema
export const seedsBulbsValidationSchema = baseProductSchema.extend({
  sowingSeason: z.array(z.string().trim()).min(1, "At least one sowing season is required"),
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
    ["descriptionOption", "dimensions", "specifications", "color", "benefits", "careInstructions", "features", "howToUse", "sowingSeason"].forEach((field) => {
      if (body[field] && typeof body[field] === "string" && (body[field].startsWith("{") || body[field].startsWith("["))) {
        try {
          body[field] = JSON.parse(body[field]);
        } catch {
          /* keep string */
        }
      }
    });

    const isUpdate = req.method === "PUT" || req.method === "PATCH";
    const baseSchema = isUpdate && typeof (schema as any).partial === "function"
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
      const errorDetails = (result.error.issues || []).map((e: any) => `${e.path.join(".")}: ${e.message}`).join("; ");
      return next(new ErrorHandler(`Validation Failed: ${errorDetails}`, 400));
    }

    // Attach validated data
    req.body = { ...req.body, ...result.data };
    next();
  };
};
