import {
  ClaimType,
  ClaimStatus,
  IClaimTimeline,
  IClaimRefundDetails,
  IClaimTrackingInfo,
  IClaimRequest,
} from "./claim.types";

export type RequestType = ClaimType;
export type RequestStatus = ClaimStatus;
export type IReturnReplacementTimeline = IClaimTimeline;
export type IReturnReplacementRefundDetails = IClaimRefundDetails;
export type IReturnReplacementRequest = IClaimRequest;

export * from "./claim.types";
