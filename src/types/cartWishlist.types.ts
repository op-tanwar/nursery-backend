import { Document, Types } from "mongoose";

export type ProductModelType =
  | "Plant"
  | "Pot"
  | "Accessory"
  | "GardeningTool"
  | "PlantCare"
  | "SeedsBulbs"
  | "PlantStandsShelves"
  | "ArtificialDriedPlant";

// ======================================================================
// 🛒 CART INTERFACES
// ======================================================================
export interface ICartItem {
  product: Types.ObjectId;
  itemModel: ProductModelType;
  quantity: number;
  nursery: Types.ObjectId;
}

export interface ICart {
  user: Types.ObjectId;
  items: Types.DocumentArray<ICartItem>;
}

export interface ICartDocument extends ICart, Document {
  createdAt: Date;
  updatedAt: Date;
}

// ======================================================================
// 💚 WISHLIST INTERFACES
// ======================================================================
export interface IWishlistItem {
  product: Types.ObjectId;
  itemModel: ProductModelType;
}

export interface IWishlist {
  user: Types.ObjectId;
  items: Types.DocumentArray<IWishlistItem>;
}

export interface IWishlistDocument extends IWishlist, Document {
  createdAt: Date;
  updatedAt: Date;
}