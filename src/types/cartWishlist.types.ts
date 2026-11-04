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

export type UnavailableReason = "NURSERY_INACTIVE" | "OUT_OF_STOCK" | "PRODUCT_DISABLED";

export interface IEnrichedCartItem {
  product: any;
  itemModel: ProductModelType;
  quantity: number;
  nursery?: Types.ObjectId | string;
  isAvailable: boolean;
  unavailableReason?: UnavailableReason;
  _id?: any;
}

export interface IEnrichedCart {
  _id?: any;
  user: Types.ObjectId | string;
  items: IEnrichedCartItem[];
  subtotal: number;
  totalAmount: number;
  availableItemsCount: number;
  unavailableItemsCount: number;
  createdAt?: Date;
  updatedAt?: Date;
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