import { Document, Types } from "mongoose";

// Review Interface for single review
export interface IReview {
  name: string;
  rating: number;
  comment: string;
  user?: Types.ObjectId;
  createdAt: Date;
}

// Description Option Interface
export interface IDescriptionOption {
  short: string;
  points: string[];
}

// Dimensions Interface
export interface IPotDimensions {
  height: string;   // e.g., "10 inches"
  diameter: string; // e.g., "8 inches"
}

// Cloudinary Image Structure
export interface ICloudinaryImage {
  public_id: string;
  url: string;
}

// Main Pot Interface
export interface IPot extends Document {
  name: string;
  slug?: string;
  description: string;
  descriptionOption: IDescriptionOption;
  material: string;        // e.g., "Ceramic", "Plastic"
  color: string[];         // Multiple colors possible
  dimensions: IPotDimensions;
  price: number;
  discountPrice?: number;
  hasDrainageHole?: boolean;
  shape: "Round" | "Square" | "Rectangular" | "Hexagonal" | "Oval" | "Custom";
  isIndoorOutdoor?: "Indoor Only" | "Outdoor Only" | "Both";
  includesSaucer?: boolean;
  category: string;        // e.g., "Indoor Pots", "Hanging Pots"
  ratings: number;
  coverImage: ICloudinaryImage;
  images: ICloudinaryImage[];
  stock: number;
  reservedStock?: number;
  availableStock?: number;
  numOfReviews: number;
  reviews: IReview[];
  metaTitle?: string;
  metaDescription?: string;
  nursery: Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}