import mongoose, { Schema } from "mongoose";
import { ICartDocument } from "../types/cartWishlist.types";

const cartSchema = new Schema<ICartDocument>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    items: [
      {
        product: {
          type: Schema.Types.ObjectId,
          required: true,
          refPath: "items.itemModel",
        },
        itemModel: {
          type: String,
          required: true,
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
        },
        quantity: {
          type: Number,
          required: true,
          min: [1, "Quantity cannot be less than 1"],
          default: 1,
        },
        nursery: {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model<ICartDocument>("Cart", cartSchema);