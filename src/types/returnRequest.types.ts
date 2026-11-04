import {
  ClaimType,
  ClaimStatus,
  IClaimRequest,
} from "./claim.types";

export type ReturnRequestType = ClaimType;
export type ReturnRequestStatus = ClaimStatus;
export type ReturnRequestReason = string;
export type IReturnRequest = IClaimRequest;

export * from "./claim.types";
