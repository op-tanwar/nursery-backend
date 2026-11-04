import mongoose, { Schema, Model } from "mongoose";
import { handleDocumentSlug } from "../utils/slugify";
import { IReview, IArtificial } from "../types/artificialDriedPlant.types";

export { IReview, IArtificial };

const artificialSchema: Schema<IArtificial> = new Schema(
  {
    name: {
      type: String,
      required: [true, "Please enter product name"],
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    slugHistory: {
      type: [String],
      default: [],
      index: true,
    },
    description: {
      type: String,
      required: [true, "Please enter product description"],
      trim: true,
    },
    descriptionOption: {
      short: {
        type: String,
        required: [true, "Please enter short description"],
        trim: true,
      },
      points: [
        {
          type: String,
          required: true,
          trim: true,
        },
      ],
    },
    specifications: {
      brand: {
        type: String,
        trim: true,
        default: "Generic",
      },
      material: {
        type: String,
        trim: true,
      },
      height: {
        type: String,
        trim: true,
      },
      color: {
        type: String,
        trim: true,
      },
      washable: {
        type: Boolean,
        default: false,
      },
      potIncluded: {
        type: Boolean,
        default: false,
      },
    },
    price: {
      type: Number,
      required: [true, "Please enter product price"],
      max: [99999999, "Price cannot exceed 8 digits"],
    },
    discountPrice: {
      type: Number,
      default: 0,
    },
    category: {
      type: String,
      required: [true, "Please enter product category"],
      trim: true,
      index: true,
    },
    ratings: {
      type: Number,
      default: 0,
    },
    coverImage: {
      public_id: {
        type: String,
        required: true,
      },
      url: {
        type: String,
        required: true,
      },
    },
    images: [
      {
        public_id: {
          type: String,
          required: true,
        },
        url: {
          type: String,
          required: true,
        },
      },
    ],
    stock: {
      type: Number,
      required: true,
      max: [9999, "Stock cannot exceed 4 digits"],
      default: 1,
    },
    reservedStock: {
      type: Number,
      default: 0,
      min: [0, "Reserved stock cannot be negative"],
    },
    numOfReviews: {
      type: Number,
      default: 0,
    },
    reviews: [
      {
        name: {
          type: String,
          required: true,
        },
        rating: {
          type: Number,
          required: true,
        },
        comment: {
          type: String,
          required: true,
        },
        user: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        isVerifiedBuyer: {
          type: Boolean,
          default: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    metaTitle: {
      type: String,
      trim: true,
    },
    metaDescription: {
      type: String,
      trim: true,
    },
    nursery: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Nursery reference required"],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// 🛒 Available Stock Virtual: availableStock = Math.max(0, stock - reservedStock)
artificialSchema.virtual("availableStock").get(function () {
  return Math.max(0, (this.stock || 0) - (this.reservedStock || 0));
});

artificialSchema.pre<IArtificial>("save", async function () {
  await handleDocumentSlug(this, {
    sourceField: "name",
    entityType: "ArtificialDriedPlant",
    suffixLength: 6,
  });
});

artificialSchema.index({ nursery: 1, isActive: 1 });
artificialSchema.index({ isActive: 1, category: 1, createdAt: -1 });
artificialSchema.index({ isActive: 1, category: 1, price: 1 });
artificialSchema.index({ isActive: 1, ratings: -1 });
artificialSchema.index({ isActive: 1, price: 1 });
artificialSchema.index({ slug: 1 }, { unique: true });
artificialSchema.index({ slugHistory: 1 });
artificialSchema.index({ name: "text", category: "text" });

const Artificial: Model<IArtificial> = mongoose.model<IArtificial>("ArtificialDriedPlant", artificialSchema);
export default Artificial;