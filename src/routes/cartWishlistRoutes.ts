import express from "express";
import {
  addToCart,
  getMyCart,
  removeFromCart,
  syncCart,
  updateCartQuantity,
  clearMyCart // 👈 Added
} from "../controllers/cartController";
import {
  toggleWishlistItem,
  getMyWishlist,
  clearMyWishlist // 👈 Added
} from "../controllers/wishlistController";
import { isAuthenticatedUser } from "../middleware/auth";

const router = express.Router();

router.use(isAuthenticatedUser);

// ======================================================================
// 🛒 CART MANAGEMENT ROUTINGS
// ======================================================================
router.route("/cart")
  .get(getMyCart)
  .post(addToCart)
  .put(updateCartQuantity)
  .delete(clearMyCart); // 👈 DELETE method cart route par call karne se pura cart clear hoga

router.route("/cart/sync").post(syncCart);
router.route("/cart/:productId").delete(removeFromCart);

// ======================================================================
// 💚 WISHLIST MANAGEMENT ROUTINGS
// ======================================================================
router.route("/wishlist")
  .get(getMyWishlist)
  .post(toggleWishlistItem)
  .delete(clearMyWishlist); // 👈 DELETE method wishlist route par call karne se puri wishlist clear hogi

export default router;