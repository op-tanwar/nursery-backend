import mongoose, { Schema, Model } from "mongoose";
import slugify from "slugify";
import { IPlantStandsShelves } from "../types/plantStandsShelves.types";

export { IPlantStandsShelves };

const plantStandsShelvesSchema: Schema<IPlantStandsShelves> = new Schema(
  {
    name: {
      type: String,
      required: [true, "Please enter stand/shelf name"],
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Please enter description"],
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
    material: {
      type: String,
      required: [true, "Please enter material type"],
      trim: true,
    },
    dimensions: {
      height: { type: String, trim: true },
      width: { type: String, trim: true },
      length: { type: String, trim: true },
    },
    tierCount: {
      type: Number,
      default: 1,
    },
    maxLoadCapacity: {
      type: String,
      trim: true,
    },
    price: {
      type: Number,
      required: [true, "Please enter price"],
      max: [99999999, "Price cannot exceed 8 digits"],
    },
    discountPrice: {
      type: Number,
      default: 0,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    ratings: {
      type: Number,
      default: 0,
    },
    coverImage: {
      public_id: { type: String, required: true },
      url: { type: String, required: true },
    },
    images: [
      {
        public_id: { type: String, required: true },
        url: { type: String, required: true },
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
        name: { type: String, required: true },
        rating: { type: Number, required: true },
        comment: { type: String, required: true },
        user: { type: Schema.Types.ObjectId, ref: "User" },
        createdAt: { type: Date, default: Date.now },
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
plantStandsShelvesSchema.virtual("availableStock").get(function () {
  return Math.max(0, (this.stock || 0) - (this.reservedStock || 0));
});

plantStandsShelvesSchema.pre<IPlantStandsShelves>("save", async function () {
  if (this.isModified("name")) {
    const baseSlug = slugify(this.name, { lower: true, strict: true });
    const uniqueSuffix = Math.floor(1000 + Math.random() * 9000);
    this.slug = `${baseSlug}-${uniqueSuffix}`;
  }
});

plantStandsShelvesSchema.index({ nursery: 1, isActive: 1 });
plantStandsShelvesSchema.index({ isActive: 1, category: 1, createdAt: -1 });
plantStandsShelvesSchema.index({ isActive: 1, category: 1, price: 1 });
plantStandsShelvesSchema.index({ isActive: 1, ratings: -1 });
plantStandsShelvesSchema.index({ isActive: 1, price: 1 });
plantStandsShelvesSchema.index({ slug: 1 });
plantStandsShelvesSchema.index({ name: "text", category: "text" });

const PlantStandsShelves: Model<IPlantStandsShelves> =
  mongoose.model<IPlantStandsShelves>(
    "PlantStandsShelves",
    plantStandsShelvesSchema
  );
export default PlantStandsShelves;