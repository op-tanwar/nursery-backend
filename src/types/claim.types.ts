import { Document, Types } from "mongoose";

export type ClaimType =
  | "RETURN"
  | "REPLACEMENT"
  | "DAMAGE_CLAIM"
  | "Return"
  | "Replacement"
  | "Damage Claim";

export type ClaimStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "COMPLETED"
  | "Pending"
  | "Approved"
  | "Rejected"
  | "Completed";

export interface IClaimTimeline {
  status: string;
  action: string;
  actor?: Types.ObjectId;
  actorRole: string;
  notes?: string;
  timestamp: Date;
}

export interface IClaimRefundDetails {
  refundId?: string;
  refundStatus: "PENDING" | "PROCESSED" | "FAILED" | "PENDING_MANUAL_REVIEW" | "NONE";
  refundAmount: number;
  refundedAt?: Date;
  failureReason?: string;
}

export interface IClaimTrackingInfo {
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  dispatchedAt?: Date;
  deliveredAt?: Date;
}

export interface IClaimRequest extends Document {
  orderId: Types.ObjectId;
  itemId: string | Types.ObjectId;
  userId: Types.ObjectId;
  nurseryId: Types.ObjectId;
  type: ClaimType;
  requestType: ClaimType; // Normalized alias
  reason: string;
  description: string;
  images: string[];
  proofImages: string[]; // Normalized alias
  unboxingVideoUrl?: string;
  status: ClaimStatus;
  adminNotes?: string;
  adminComments?: string; // Legacy alias
  refundStatus?: "NONE" | "PENDING" | "PROCESSED" | "FAILED" | "PENDING_MANUAL_REVIEW";
  refundDetails?: IClaimRefundDetails;
  trackingInfo?: IClaimTrackingInfo;
  productName: string;
  productImage: string;
  productModel?: string;
  replacementOrderId?: Types.ObjectId;
  inventoryAction?: "RESTOCKED" | "DEFECTIVE_RECORDED" | "REPLACEMENT_DISPATCHED" | "NONE";
  isProcessed: boolean;
  resolvedAt?: Date;
  timeline: IClaimTimeline[];
  createdAt: Date;
  updatedAt: Date;
}
