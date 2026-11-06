import { Router } from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  forgotPassword,
  resetPassword,
  socialLogin,
  getUserDetails,
} from "../controllers/userController";
import { isAuthenticatedUser } from "../middleware/auth";

const router = Router();

// ======================================================================
// 🔐 AUTHENTICATION ENDPOINTS (/api/v1/auth)
// ======================================================================

// Google OAuth authentication
router.post("/social-login", socialLogin);
router.post("/google", socialLogin);

// Standard authentication endpoints
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", logoutUser);
router.post("/password/forgot", forgotPassword);
router.put("/password/reset/:token", resetPassword);

// Current Authenticated Session Endpoint (HTTP-only cookie validation)
router.get("/me", isAuthenticatedUser, getUserDetails);

export default router;
