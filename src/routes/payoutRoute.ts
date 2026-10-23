import express from "express";
import {
  getNurseryPayoutSummary,
  getNurseryPayoutHistory,
  requestPayout,
  getNurseryCommissionBreakdown,
  getAdminPayoutsList,
  adminUpdatePayoutStatus,
} from "../controllers/payoutController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";

const router = express.Router();

// ======================================================================
// 🏡 NURSERY PAYOUT ENDPOINTS
// Accessible by nursery vendors
// ======================================================================

// GET /api/v1/payouts/nursery and /api/v1/payouts/nursery/summary
router
  .route("/nursery")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getNurseryPayoutSummary);

router
  .route("/nursery/summary")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getNurseryPayoutSummary);


// GET /api/v1/payouts/nursery/history
router
  .route("/nursery/history")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getNurseryPayoutHistory);

// POST /api/v1/payouts/nursery/request
router
  .route("/nursery/request")
  .post(isAuthenticatedUser, authorizeRoles("nursery"), requestPayout);

// GET /api/v1/payouts/nursery/commission-breakdown
router
  .route("/nursery/commission-breakdown")
  .get(isAuthenticatedUser, authorizeRoles("nursery"), getNurseryCommissionBreakdown);

// ======================================================================
// 🛡️ ADMIN PAYOUT ENDPOINTS
// Accessible by administrators
// ======================================================================

// GET /api/v1/payouts/admin and /api/v1/payouts/admin/list
router
  .route("/admin")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminPayoutsList);

router
  .route("/admin/list")
  .get(isAuthenticatedUser, authorizeRoles("admin"), getAdminPayoutsList);


// PATCH & PUT /api/v1/payouts/admin/:id/status
router
  .route("/admin/:id/status")
  .patch(isAuthenticatedUser, authorizeRoles("admin"), adminUpdatePayoutStatus)
  .put(isAuthenticatedUser, authorizeRoles("admin"), adminUpdatePayoutStatus);

router
  .route("/admin/status/:id")
  .patch(isAuthenticatedUser, authorizeRoles("admin"), adminUpdatePayoutStatus)
  .put(isAuthenticatedUser, authorizeRoles("admin"), adminUpdatePayoutStatus);

// ── Explicit semantic aliases ─────────────────────────────────────────────
// POST /api/v1/payouts/admin/:id/approve  (set status → PROCESSING)
router
  .route("/admin/:id/approve")
  .post(isAuthenticatedUser, authorizeRoles("admin"), adminUpdatePayoutStatus);

// POST /api/v1/payouts/admin/:id/process  (alias for approve)
router
  .route("/admin/:id/process")
  .post(isAuthenticatedUser, authorizeRoles("admin"), adminUpdatePayoutStatus);

// POST /api/v1/payouts/admin/:id/complete (set status → COMPLETED, requires UTR)
router
  .route("/admin/:id/complete")
  .post(isAuthenticatedUser, authorizeRoles("admin"), adminUpdatePayoutStatus);

// POST /api/v1/payouts/admin/:id/reject  (set status → REJECTED, requires reason)
router
  .route("/admin/:id/reject")
  .post(isAuthenticatedUser, authorizeRoles("admin"), adminUpdatePayoutStatus);

export default router;
