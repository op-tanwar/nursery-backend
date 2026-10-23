import { Document, Types } from "mongoose";

// Review Interface
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

// Specifications Interface for Artificial & Dried items
export interface IArtificialSpecification {
  brand?: string;
  material?: string;      // e.g., "Silk", "Polyester", "Natural Dried Palm"
  height?: string;        // e.g., "45 cm", "3 Feet"
  color?: string;         // e.g., "Dusty Pink", "Natural Green"
  washable?: boolean;     // e.g., true / false
  potIncluded?: boolean;  // e.g., true / false
}

// Cloudinary Image Structure
export interface ICloudinaryImage {
  public_id: string;
  url: string;
}

// Main Artificial Interface
export interface IArtificial extends Document {
  name: string;
  slug?: string;
  description: string;
  descriptionOption: IDescriptionOption;
  specifications: IArtificialSpecification;
  price: number;
  discountPrice?: number;
  category: string;        // e.g., "Artificial Plants", "Dried Botanical Decor"
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