import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICategoryTax extends Document {
  category: string;
  itemModel: string;
  taxPercentage: number;
  isTaxInclusive: boolean;
  description?: string;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const categoryTaxSchema = new Schema<ICategoryTax>(
  {
    category: {
      type: String,
      required: [true, "Category name is required"],
      unique: true,
      trim: true,
    },
    itemModel: {
      type: String,
      required: [true, "Item model mapping is required"],
      enum: [
        "Plant",
        "Pot",
        "Accessory",
        "GardeningTool",
        "PlantCare",
        "SeedsBulbs",
        "PlantStandsShelves",
        "ArtificialDriedPlant",
      ],
      trim: true,
    },
    taxPercentage: {
      type: Number,
      required: [true, "Tax percentage is required"],
      min: [0, "Tax percentage cannot be negative"],
      max: [100, "Tax percentage cannot exceed 100%"],
      default: 18,
    },
    isTaxInclusive: {
      type: Boolean,
      default: false,
    },
    description: {
      type: String,
      trim: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

categoryTaxSchema.index({ itemModel: 1 });

export const CategoryTax = mongoose.model<ICategoryTax>("CategoryTax", categoryTaxSchema);
export default CategoryTax;
