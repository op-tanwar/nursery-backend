import express from "express";
import {
  addToCart,
  getMyCart,
  removeFromCart,
  syncCart,
  updateCartQuantity,
  clearMyCart,
} from "../controllers/cartController";
import { isAuthenticatedUser } from "../middleware/auth";

const cartRouter = express.Router();

// 🔐 Authentication Guard: All cart operations require an authenticated customer session
cartRouter.use(isAuthenticatedUser);

// ======================================================================
// 🛒 CART MANAGEMENT ROUTINGS
// ======================================================================
cartRouter
  .route("/")
  .get(getMyCart)
  .post(addToCart)
  .put(updateCartQuantity)
  .delete(clearMyCart);

cartRouter.route("/sync").post(syncCart);
cartRouter.route("/:productId").delete(removeFromCart);

export default cartRouter;
