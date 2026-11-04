import {
  createClaimRequest,
  getAllClaimsAdmin,
  updateClaimStatus,
  getClaimsByNursery,
  getClaimsByUser,
  getClaimById,
} from "./returnClaimController";

// ======================================================================
// 🔄 BACKWARD-COMPATIBLE ALIASES FOR UNIFIED RETURN / CLAIM SYSTEM
// ======================================================================
export const createReturnRequest = createClaimRequest;
export const getAllReturnRequestsAdmin = getAllClaimsAdmin;
export const updateReturnRequestStatusAdmin = updateClaimStatus;
export const getNurseryReturnRequests = getClaimsByNursery;
export const getOrderReturnRequests = getClaimsByUser;
export const getSingleReturnRequest = getClaimById;

export * from "./returnClaimController";
