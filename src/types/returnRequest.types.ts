import { Document, Types } from "mongoose";

export type ReturnRequestType = "Return" | "Replacement";

export type ReturnRequestReason =
  | "Damaged Plant/Pot"
  | "Wrong Item Received"
  | "Poor Plant Quality"
  | "Other";

export type ReturnRequestStatus = "Pending" | "Approved" | "Rejected" | "Completed";

export interface IReturnRequest extends Document {
  order: Types.ObjectId;
  orderItem: Types.ObjectId;
  product: Types.ObjectId;
  productModel?: string;
  productName?: string;
  productImage?: string;
  user: Types.ObjectId;
  nursery: Types.ObjectId;
  requestType: ReturnRequestType;
  reason: ReturnRequestReason;
  description: string;
  proofImages: string[];
  status: ReturnRequestStatus;
  adminComments?: string;
  createdAt: Date;
  updatedAt: Date;
}
