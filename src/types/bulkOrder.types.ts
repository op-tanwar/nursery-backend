import { Document } from "mongoose";

export type BulkOrderProductType =
  | "plants"
  | "pots"
  | "fertilizers"
  | "services"
  | "accessories"
  | "mixed";

export type BulkOrderStatus =
  | "Pending"
  | "In Discussion"
  | "Quoted"
  | "Fulfilled"
  | "Cancelled";

export const BULK_ORDER_STATUSES: BulkOrderStatus[] = [
  "Pending",
  "In Discussion",
  "Quoted",
  "Fulfilled",
  "Cancelled",
];

export const BULK_ORDER_PRODUCT_TYPES: BulkOrderProductType[] = [
  "plants",
  "pots",
  "fertilizers",
  "services",
  "accessories",
  "mixed",
];

export interface IBulkOrder {
  fullName: string;
  phoneNumber: string;
  email?: string;
  city: string;
  state: string;
  productType: BulkOrderProductType;
  estimatedQuantity: number;
  message?: string;
  status: BulkOrderStatus;
  adminNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBulkOrderDocument extends IBulkOrder, Document {}