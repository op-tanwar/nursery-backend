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

// Cloudinary Image Structure Interface
export interface ICloudinaryImage {
  public_id: string;
  url: string;
}

// Main Plant Interface
export interface IPlant extends Document {
  name: string;
  slug?: string;
  description: string;
  descriptionOption: IDescriptionOption;
  benefits: string[];
  careInstructions: string[];
  price: number;
  discountPrice?: number;
  lightRequirement: "Direct Sunlight" | "Indirect Light" | "Low Light";
  wateringSchedule: "Everyday" | "Alternate Days" | "Once a Week" | "When Dry";
  maintenanceLevel?: "Easy" | "Moderate" | "High";
  isPetFriendly?: boolean;
  category: string;
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