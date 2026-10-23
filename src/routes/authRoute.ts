import { Router } from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  forgotPassword,
  resetPassword,
  socialLogin,
} from "../controllers/userController";

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

export default router;
