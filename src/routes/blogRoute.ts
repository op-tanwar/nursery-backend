import express from "express";
import {
  createBlog,
  getBlogBySlug,
  getBlogById,
  getAllBlogs,
  updateBlog,
  deleteBlog
} from "../controllers/blogController";
import { isAuthenticatedUser, authorizeRoles } from "../middleware/auth";

const router = express.Router();

// ======================================================================
// 🛡️ MANAGED AUTH ADMINISTRATIVE SECURE ENDPOINTS
// (Must be defined first so :slug doesn't intercept /new or /manage)
// ======================================================================

// Create Route: Admin or Approved Nurseries can post content
router
  .route("/blog/new")
  .post(isAuthenticatedUser, authorizeRoles("admin", "nursery"), createBlog);

router
  .route("/new")
  .post(isAuthenticatedUser, authorizeRoles("admin", "nursery"), createBlog);

// Management Route: GET single by ID, PUT (Update) and DELETE actions
router
  .route("/blog/manage/:id")
  .get(getBlogById)
  .put(isAuthenticatedUser, authorizeRoles("admin", "nursery"), updateBlog)
  .delete(isAuthenticatedUser, authorizeRoles("admin", "nursery"), deleteBlog);

router
  .route("/manage/:id")
  .get(getBlogById)
  .put(isAuthenticatedUser, authorizeRoles("admin", "nursery"), updateBlog)
  .delete(isAuthenticatedUser, authorizeRoles("admin", "nursery"), deleteBlog);

// ======================================================================
// 🌍 OPEN MARKETPLACE PUBLIC ACCESS ENDPOINTS
// ======================================================================

// Blog catalog listings
router.get("/blogs", getAllBlogs);
router.get("/", getAllBlogs);

// Blog article retrieval by slug (supporting multiple REST conventions)
router.get("/slug/:slug", getBlogBySlug);
router.get("/blog/:slug", getBlogBySlug);
router.get("/blogs/:slug", getBlogBySlug);

// Root parameter fallback (e.g., when router is mounted at /blogs/:slug or /blog/:slug)
router.get("/:slug", getBlogBySlug);

export default router;
