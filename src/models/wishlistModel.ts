import mongoose, { Schema } from "mongoose";
import { IWishlistDocument } from "../types/cartWishlist.types";

const wishlistSchema = new Schema<IWishlistDocument>(
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
            "ArtificialDriedPlant"
          ],
        },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model<IWishlistDocument>("Wishlist", wishlistSchema);