import { Document, Types } from "mongoose";

export interface IBusinessAddress {
  address?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  country?: string;
}

export interface IBankDetails {
  accountHolderName?: string;
  accountNumber?: string;
  ifscCode?: string;
  bankName?: string;
}

export type TApprovalStatus = "Pending" | "Approved" | "Rejected";
export type TVerificationStatus = "Pending" | "Approved" | "Rejected";
export type TDocumentType =
  | "gstin"
  | "panCard"
  | "nurseryLicense"
  | "identityProof"
  | "bankDetails";

export interface INurseryDocumentItem {
  url?: string;
  publicId?: string;
  status: TVerificationStatus;
  rejectionReason?: string;
  uploadedAt?: Date;
}

export interface INurseryDocuments {
  gstin?: INurseryDocumentItem;
  panCard?: INurseryDocumentItem;
  nurseryLicense?: INurseryDocumentItem;
  identityProof?: INurseryDocumentItem;
  bankDetails?: INurseryDocumentItem;
}

export interface ICommissionOverride {
  category: string;
  customCommissionPercentage: number;
}

export interface INurseryProfileInput {
  nursery: Types.ObjectId;
  businessName: string;
  slug?: string;
  description?: string;
  coverImage?: {
    public_id?: string;
    url?: string;
  };
  rating?: number;
  numOfReviews?: number;
  businessEmail: string;
  businessPhone: string;
  gstin?: string;
  panNumber?: string;
  businessAddress?: IBusinessAddress;
  bankDetails?: IBankDetails;
  documents?: INurseryDocuments;
  verificationStatus?: TVerificationStatus;
  adminReviewNotes?: string;
  documentsSubmittedAt?: Date;
  approvalStatus: TApprovalStatus;
  isActive: boolean;
  rejectionReason?: string;
  deliveryPincodes?: string[];
  commissionOverrides?: ICommissionOverride[];
  defaultNurseryCommission?: number;
}

export interface INurseryProfile extends Document {
  nursery: Types.ObjectId;
  businessName: string;
  slug: string;
  description?: string;
  coverImage?: {
    public_id?: string;
    url?: string;
  };
  rating: number;
  numOfReviews: number;
  businessEmail: string;
  businessPhone: string;
  gstin?: string;
  panNumber?: string;
  businessAddress: IBusinessAddress;
  bankDetails: IBankDetails;
  documents: INurseryDocuments;
  verificationStatus: TVerificationStatus;
  adminReviewNotes?: string;
  documentsSubmittedAt?: Date;
  approvalStatus: TApprovalStatus;
  isActive: boolean;
  rejectionReason?: string;
  deliveryPincodes: string[];
  commissionOverrides?: ICommissionOverride[];
  defaultNurseryCommission?: number;
  createdAt: Date;
  updatedAt: Date;
}