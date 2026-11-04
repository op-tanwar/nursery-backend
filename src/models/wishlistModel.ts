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
          ref: "Product",
        },
        itemModel: {
          type: String,
          default: "Product",
        },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model<IWishlistDocument>("Wishlist", wishlistSchema);
