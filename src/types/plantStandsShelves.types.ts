import { Document, Types } from "mongoose";

export interface IReview {
  name: string;
  rating: number;
  comment: string;
  user?: Types.ObjectId;
  createdAt: Date;
}

export interface IDescriptionOption {
  short: string;
  points: string[];
}

export interface ICloudinaryImage {
  public_id: string;
  url: string;
}

export interface IDimensions {
  height?: string;
  width?: string;
  length?: string;
}

export interface IPlantStandsShelves extends Document {
  name: string;
  slug?: string;
  description: string;
  descriptionOption: IDescriptionOption;
  material: string;
  dimensions?: IDimensions;
  tierCount?: number;
  maxLoadCapacity?: string;
  price: number;
  discountPrice?: number;
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