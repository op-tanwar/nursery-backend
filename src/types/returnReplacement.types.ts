import { Document, Types } from "mongoose";

export type RequestType = "Return" | "Replacement";
export type RequestStatus = "Pending" | "Approved" | "Rejected" | "Completed";

export interface IReturnReplacementRequest extends Document {
  orderId: Types.ObjectId;
  userId: Types.ObjectId;
  nurseryId: Types.ObjectId;
  itemId: string | Types.ObjectId;
  productName: string;
  productImage: string;
  requestType: RequestType;
  reason: string;
  description: string;
  proofImages: string[];
  status: RequestStatus;
  adminNotes?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
