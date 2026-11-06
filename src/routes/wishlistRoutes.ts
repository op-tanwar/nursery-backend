import express from "express";
import {
  getMyWishlist,
  toggleWishlistItem,
  clearMyWishlist,
} from "../controllers/wishlistController";
import { isAuthenticatedUser } from "../middleware/auth";

const wishlistRouter = express.Router();

// 🔐 Authentication Guard: All wishlist operations require an authenticated customer session
wishlistRouter.use(isAuthenticatedUser);

// ======================================================================
// 💚 WISHLIST MANAGEMENT ROUTINGS
// ======================================================================
wishlistRouter
  .route("/")
  .get(getMyWishlist)
  .post(toggleWishlistItem)
  .delete(clearMyWishlist);

export default wishlistRouter;
