import { Router } from "express";
import {
  registerUser,
  loginUser,
  nurseryDashboardLogin,
  adminDashboardLogin,
  logoutUser,
  logoutNursery,
  logoutAdmin,
  forgotPassword,
  resetPassword,
  getUserDetails,
  updatePassword,
  updateProfile,
  getAllUsers,
  getSingleUser,
  updateUserRole,
  deleteUser,
  getAllNurseryUsers,
  socialLogin,
  submitContactInquiry,
} from "../controllers/userController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";

const router = Router();

// ------------------------
// Auth & Contact Routes
// ------------------------
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/social-login", socialLogin);
router.post("/contact", submitContactInquiry);

// ------------------------
// Dashboard Logins
// ------------------------
router.post("/nursery-login", nurseryDashboardLogin);
router.post("/admin-login", adminDashboardLogin);

// ------------------------
// Logout Routes (🔒 FIXED: Changed from GET to POST for CSRF Protection)
// ------------------------
router.post("/logout", logoutUser);
router.post("/logout-nursery", logoutNursery);
router.post("/logout-admin", logoutAdmin);

// ------------------------
// Password Recovery
// ------------------------
router.post("/password/forgot", forgotPassword);
router.put("/password/reset/:token", resetPassword);

// ------------------------
// Email System Test (Development Only)
// ------------------------
router.post("/test-email", async (req: any, res: any) => {
  if (process.env.NODE_ENV !== "development") {
    return res.status(404).json({ success: false, message: "Not found" });
  }
  try {
    const sendEmail = (await import("../utils/sendEmail")).default;
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });

    await sendEmail({
      email,
      subject: "Urban Nursery Email System Test",
      message: "This is a test email from the Urban Nursery backend. If you received this, the email system is working correctly.",
    });

    res.status(200).json({ success: true, message: "Test email sent successfully" });
  } catch (error: any) {
    console.error("Test email failed:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ------------------------
// User Profile Routes
// ------------------------
router.get("/me", isAuthenticatedUser, getUserDetails);
router.put("/password/update", isAuthenticatedUser, updatePassword);
router.put("/me/update", isAuthenticatedUser, updateProfile);

// ------------------------
// Admin User Management
// ------------------------
router.get(
  "/admin/users",
  isAuthenticatedUser,
  authorizeRoles("admin"),
  getAllUsers
);

router.get(
  "/admin/user/:id",
  isAuthenticatedUser,
  authorizeRoles("admin"),
  getSingleUser
);

router.put(
  "/admin/user/:id",
  isAuthenticatedUser,
  authorizeRoles("admin"),
  updateUserRole
);

router.delete(
  "/admin/user/:id",
  isAuthenticatedUser,
  authorizeRoles("admin"),
  deleteUser
);

router.get(
  "/admin/nursery-users",
  isAuthenticatedUser,
  authorizeRoles("admin"),
  getAllNurseryUsers
);

export default router;