import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICategoryCommission extends Document {
  category: string;
  itemModel: string;
  commissionPercentage: number;
  description?: string;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const categoryCommissionSchema = new Schema<ICategoryCommission>(
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
    commissionPercentage: {
      type: Number,
      required: [true, "Commission percentage is required"],
      min: [0, "Commission percentage cannot be negative"],
      max: [100, "Commission percentage cannot exceed 100%"],
      default: 10,
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

categoryCommissionSchema.index({ itemModel: 1 });

export const CategoryCommission = mongoose.model<ICategoryCommission>(
  "CategoryCommission",
  categoryCommissionSchema
);

export default CategoryCommission;
