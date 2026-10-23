import express, { Router } from "express";
import {
  getNurseryDashboardStats,
  getAdminDashboardStats,
} from "../controllers/dashboardController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";

const router: Router = express.Router();

/**
 * Shared query parameters:
 * - timeframe: today | yesterday | this_week | last_week | this_month |
 *              last_month | this_year | last_year | lifetime | custom
 * - startDate / endDate: required when timeframe=custom (ISO / YYYY-MM-DD)
 *
 * Financial model returned by both endpoints:
 *   Net = Gross − Commission  (paise-rounded)
 *   Fees: Plant 30% | Pot 25% | Accessory 20%
 *   Settlement: Current Week Payable | Pending (last week) | Lifetime Settled
 */

router
  .route([
    "/nursery/dashboard",
    "/nursery",
    "/nursery/dashboard-stats",
  ])
  .get(
    isAuthenticatedUser,
    authorizeRoles("nursery"),
    getNurseryDashboardStats
  );

router
  .route([
    "/admin/dashboard",
    "/admin",
    "/admin/dashboard-stats",
  ])
  .get(
    isAuthenticatedUser,
    authorizeRoles("admin"),
    getAdminDashboardStats
  );

export default router;
