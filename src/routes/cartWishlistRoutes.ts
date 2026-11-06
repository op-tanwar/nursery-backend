import express from "express";
import cartRouter from "./cartRoutes";
import wishlistRouter from "./wishlistRoutes";

const shopRouter = express.Router();

// 🛒 Consolidate cart and wishlist under relative domain sub-paths
shopRouter.use("/cart", cartRouter);
shopRouter.use("/wishlist", wishlistRouter);

export { cartRouter, wishlistRouter };
export default shopRouter;
