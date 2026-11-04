import mongoose, { Schema, Document, Model, Types } from "mongoose";
import { handleDocumentSlug } from "../utils/slugify";

// ======================================================================
// 🏷️ 1. ENUMS & CATEGORY-SPECIFIC ATTRIBUTE INTERFACES
// ======================================================================

export const PRODUCT_CATEGORIES = [
  "plants",
  "pots",
  "accessories",
  "gardening-tools",
  "plant-care",
  "seeds-bulbs",
  "stands-shelves",
  "artificial-dried",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export interface PlantAttributes {
  lightRequirement?: string;
  wateringSchedule?: string;
  maintenanceLevel?: "Easy" | "Medium" | "High" | string;
  isPetFriendly?: boolean;
  benefits?: string[];
  careInstructions?: string[];
  plantType?: "Indoor" | "Outdoor" | "Flowering" | "Air Purifying" | "Succulent" | string;
}

export interface PotAttributes {
  material?: string;
  color?: string[] | string;
  dimensions?: {
    height?: string;
    diameter?: string;
    width?: string;
    length?: string;
  };
  drainageHoles?: boolean;
  shape?: string;
}

export interface AccessoryAttributes {
  material?: string;
  brand?: string;
  weight?: string;
  capacity?: string;
  usageType?: string;
}

export interface GardeningToolAttributes {
  features?: string[];
  material?: string;
  handleMaterial?: string;
  warrantyMonths?: number;
  toolType?: string;
}

export interface PlantCareAttributes {
  composition?: string;
  howToUse?: string[];
  volumeOrWeight?: string;
  formType?: "Liquid" | "Granules" | "Powder" | "Pellets" | string;
  suitableFor?: string[];
}

export interface SeedsBulbsAttributes {
  sowingSeason?: string[];
  germinationTime?: string;
  quantityPerPack?: string;
  sunlightRequirement?: string;
  seedType?: string;
}

export interface StandsShelvesAttributes {
  material?: string;
  dimensions?: {
    height?: string;
    width?: string;
    length?: string;
  };
  tierCount?: number;
  maxLoadCapacity?: string;
  isFoldable?: boolean;
}

export interface ArtificialDriedAttributes {
  material?: string;
  height?: string;
  color?: string;
  brand?: string;
  includesVase?: boolean;
}

export type CategoryAttributes =
  | PlantAttributes
  | PotAttributes
  | AccessoryAttributes
  | GardeningToolAttributes
  | PlantCareAttributes
  | SeedsBulbsAttributes
  | StandsShelvesAttributes
  | ArtificialDriedAttributes
  | Record<string, any>;

// ======================================================================
// 🧱 2. REVIEW & MEDIA TYPES
// ======================================================================

export interface IProductReview {
  _id?: Types.ObjectId;
  name: string;
  rating: number;
  comment: string;
  user?: Types.ObjectId;
  isVerifiedBuyer?: boolean;
  createdAt?: Date;
}

export interface IProductImage {
  public_id: string;
  url: string;
}

// ======================================================================
// 🌿 3. BASE UNIFIED PRODUCT INTERFACE
// ======================================================================

export interface IProduct extends Document {
  name: string;
  slug: string;
  slugHistory: string[];
  category: ProductCategory;
  nursery: Types.ObjectId;
  price: number;
  discountPrice: number;
  stock: number;
  reservedStock: number;
  availableStock: number;
  coverImage?: IProductImage;
  images: IProductImage[];
  description: string;
  descriptionOption?: {
    short?: string;
    points?: string[];
  };
  isPublished: boolean;
  isActive: boolean; // Backward-compatibility alias for isPublished
  ratingsAverage: number;
  ratingsQuantity: number;
  ratings: number; // Backward-compatibility alias
  numOfReviews: number; // Backward-compatibility alias
  reviews: IProductReview[];
  metaTitle?: string;
  metaDescription?: string;
  tags: string[];
  attributes: CategoryAttributes;
  createdAt: Date;
  updatedAt: Date;
}

// ======================================================================
// 🗄️ 4. MONGOOSE SCHEMA DEFINITION
// ======================================================================

const reviewSchema = new Schema<IProductReview>(
  {
    name: { type: String, required: true, trim: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, trim: true },
    user: { type: Schema.Types.ObjectId, ref: "User" },
    isVerifiedBuyer: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const productImageSchema = new Schema<IProductImage>(
  {
    public_id: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const productSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: [true, "Please provide product name"],
      trim: true,
      maxlength: [200, "Product name cannot exceed 200 characters"],
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    slugHistory: {
      type: [String],
      default: [],
      index: true,
    },
    category: {
      type: String,
      required: [true, "Please select product category"],
      enum: {
        values: PRODUCT_CATEGORIES,
        message: "Invalid product category: `{VALUE}`",
      },
      index: true,
    },
    nursery: {
      type: Schema.Types.ObjectId,
      ref: "NurseryProfile",
      required: [true, "Product must belong to a registered nursery"],
      index: true,
    },
    price: {
      type: Number,
      required: [true, "Please enter product price"],
      min: [0, "Price cannot be negative"],
      max: [99999999, "Price cannot exceed 8 digits"],
    },
    discountPrice: {
      type: Number,
      default: 0,
      min: [0, "Discount price cannot be negative"],
    },
    stock: {
      type: Number,
      required: [true, "Please specify available inventory stock"],
      min: [0, "Stock cannot be negative"],
      max: [99999, "Stock cannot exceed 5 digits"],
      default: 1,
    },
    reservedStock: {
      type: Number,
      default: 0,
      min: [0, "Reserved stock cannot be negative"],
    },
    coverImage: {
      type: productImageSchema,
    },
    images: {
      type: [productImageSchema],
      default: [],
    },
    description: {
      type: String,
      required: [true, "Please provide product description"],
      trim: true,
    },
    descriptionOption: {
      short: { type: String, trim: true },
      points: [{ type: String, trim: true }],
    },
    isPublished: {
      type: Boolean,
      default: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    ratingsAverage: {
      type: Number,
      default: 0,
      min: [0, "Rating must be at least 0"],
      max: [5, "Rating cannot exceed 5"],
      set: (val: number) => Math.round(val * 10) / 10,
    },
    ratingsQuantity: {
      type: Number,
      default: 0,
    },
    ratings: {
      type: Number,
      default: 0,
    },
    numOfReviews: {
      type: Number,
      default: 0,
    },
    reviews: [reviewSchema],
    metaTitle: { type: String, trim: true },
    metaDescription: { type: String, trim: true },
    tags: [{ type: String, trim: true }],
    // Dynamic polymorphic payload holding category-specific attributes
    attributes: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ======================================================================
// ⚡ 5. VIRTUALS & SYNCHRONIZATION HOOKS
// ======================================================================

// 🛒 Available Stock Virtual: availableStock = Math.max(0, stock - reservedStock)
productSchema.virtual("availableStock").get(function () {
  return Math.max(0, (this.stock || 0) - (this.reservedStock || 0));
});

// Synchronize backward-compatibility alias fields
productSchema.pre("validate", function () {
  if (this.isPublished !== undefined && this.isActive === undefined) {
    this.isActive = this.isPublished;
  } else if (this.isActive !== undefined && this.isPublished === undefined) {
    this.isPublished = this.isActive;
  }

  if (this.ratingsAverage !== undefined && !this.ratings) {
    this.ratings = this.ratingsAverage;
  } else if (this.ratings !== undefined && !this.ratingsAverage) {
    this.ratingsAverage = this.ratings;
  }

  if (this.ratingsQuantity !== undefined && !this.numOfReviews) {
    this.numOfReviews = this.ratingsQuantity;
  } else if (this.numOfReviews !== undefined && !this.ratingsQuantity) {
    this.ratingsQuantity = this.numOfReviews;
  }

  // Ensure coverImage exists if images array has items
  if ((!this.coverImage || !this.coverImage.url) && this.images && this.images.length > 0) {
    this.coverImage = this.images[0];
  }
});

// Collision-proof deterministic slug generator with history tracking
productSchema.pre<IProduct>("save", async function () {
  await handleDocumentSlug(this, {
    sourceField: "name",
    entityType: "Product",
    suffixLength: 6,
  });
});

// ======================================================================
// 🚀 6. COMPOUND & PERFORMANCE INDEXES
// ======================================================================

// Fast category catalog filtering with pagination sorting:
productSchema.index({ category: 1, isPublished: 1, price: 1 });
productSchema.index({ category: 1, isPublished: 1, createdAt: -1 });

// Nursery vendor storefront filtering:
productSchema.index({ nursery: 1, isPublished: 1, createdAt: -1 });
productSchema.index({ nursery: 1, isActive: 1 });

// High-ratings sorting:
productSchema.index({ isPublished: 1, ratingsAverage: -1 });

// Direct B-tree index on product name for fast prefix & sorting:
productSchema.index({ name: 1 });

// Full text search index across title and description:
productSchema.index({ name: "text", description: "text" });

const Product: Model<IProduct> = mongoose.model<IProduct>("Product", productSchema);
export default Product;
