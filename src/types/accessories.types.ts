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

// Technical Specifications Interface
export interface ITechnicalSpecification {
  brand?: string;
  weight?: string;        // e.g., "500g", "2kg"
  material?: string;      // e.g., "Stainless Steel", "HDPE Plastic"
  capacity?: string;      // e.g., "5 Liters" or "10 KG"
  dimensions?: string;    // e.g., "15 x 10 x 5 cm"
}

// Cloudinary Image Structure
export interface ICloudinaryImage {
  public_id: string;
  url: string;
}

// Main Accessory Interface
export interface IAccessory extends Document {
  name: string;
  slug?: string;
  description: string;
  descriptionOption: IDescriptionOption;
  specifications: ITechnicalSpecification;
  price: number;
  discountPrice?: number;
  category: string;        // e.g., "Tools", "Fertilizers"
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