import { Document, Types } from "mongoose";

export type RequestType = "Return" | "Replacement";
export type RequestStatus = "Pending" | "Approved" | "Rejected" | "Completed";

export interface IReturnReplacementTimeline {
  status: RequestStatus;
  action: string;
  actor?: Types.ObjectId;
  actorRole: string;
  notes?: string;
  timestamp: Date;
}

export interface IReturnReplacementRefundDetails {
  refundId?: string;
  refundStatus: "PENDING" | "PROCESSED" | "FAILED" | "PENDING_MANUAL_REVIEW";
  refundAmount: number;
  refundedAt?: Date;
  failureReason?: string;
}

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
  isProcessed: boolean;
  refundDetails?: IReturnReplacementRefundDetails;
  replacementOrderId?: Types.ObjectId;
  inventoryAction?: "RESTOCKED" | "DEFECTIVE_RECORDED" | "REPLACEMENT_DISPATCHED" | "NONE";
  timeline: IReturnReplacementTimeline[];
  createdAt: Date;
  updatedAt: Date;
}
