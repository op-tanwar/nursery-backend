import express from "express";
import {
  createProduct,
  getAllProducts,
  getProductByIdOrSlug,
  updateProduct,
  deleteProduct,
  getNurseryProducts,
  getMyNurseryProducts,
  createProductReview,
  deleteProductReview,
  toggleProductStatus,
} from "../controllers/productController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";

const router = express.Router();

// Vendor Authenticated Inventory Query (must be declared before :idOrSlug)
router
  .route("/vendor/my-products")
  .get(isAuthenticatedUser, authorizeRoles("admin", "nursery"), getMyNurseryProducts);

// Public Catalog Queries
router.route("/").get(getAllProducts);
router.route("/category/:category").get(getAllProducts);
router.route("/nursery/:nurseryId").get(getNurseryProducts);
router.route("/:idOrSlug").get(getProductByIdOrSlug);

// Vendor & Admin Management Routes
router
  .route("/")
  .post(isAuthenticatedUser, authorizeRoles("admin", "nursery"), createProduct);

router
  .route("/:id/toggle-status")
  .put(isAuthenticatedUser, authorizeRoles("admin", "nursery"), toggleProductStatus);

router
  .route("/:id")
  .put(isAuthenticatedUser, authorizeRoles("admin", "nursery"), updateProduct)
  .delete(isAuthenticatedUser, authorizeRoles("admin", "nursery"), deleteProduct);

// Customer Review Routes
router
  .route("/:id/review")
  .post(isAuthenticatedUser, createProductReview);

router
  .route("/:id/review/:reviewId")
  .delete(isAuthenticatedUser, deleteProductReview);

export default router;
