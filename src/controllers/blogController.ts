import { Request, Response, NextFunction } from "express";
import { UploadedFile } from "express-fileupload";
import cloudinary from "cloudinary";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import Blog from "../models/blogModel";
import { sendNewBlogNotificationEmail } from "../utils/blogEmailService";
import cacheManager from "../utils/cacheManager";

// Helper function to cleanly escape special regex characters: \ ^ $ * + ? . ( ) | { } [ ]
const escapeRegexCharacters = (text: string): string => {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
};

// Helper utility to parse tags from array, stringified array, or comma-separated string
const parseTags = (inputTags: any): string[] => {
  if (!inputTags) return [];
  if (Array.isArray(inputTags)) return inputTags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof inputTags === "string") {
    try {
      const parsed = JSON.parse(inputTags);
      if (Array.isArray(parsed)) return parsed.map((t) => String(t).trim()).filter(Boolean);
    } catch (e) {}
    return inputTags.split(",").map((t) => t.trim()).filter(Boolean);
  }
  return [];
};

// ======================================================================
// ✍️ 1. CREATE BLOG (For Admin & Approved Nurseries)
// ======================================================================
export const createBlog = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { title, content, tags } = req.body;
    let coverImageUrl = typeof req.body.coverImage === "string" ? req.body.coverImage : "";

    // Handle file upload via express-fileupload
    if (req.files && req.files.coverImage) {
      const file = (Array.isArray(req.files.coverImage) ? req.files.coverImage[0] : req.files.coverImage) as UploadedFile;
      const uploaded = await cloudinary.v2.uploader.upload(file.tempFilePath, {
        folder: "urban-nursery/blogs",
      });
      coverImageUrl = uploaded.secure_url;
    } else if (typeof coverImageUrl === "string" && coverImageUrl.startsWith("data:image")) {
      const uploaded = await cloudinary.v2.uploader.upload(coverImageUrl, {
        folder: "urban-nursery/blogs",
      });
      coverImageUrl = uploaded.secure_url;
    }

    if (!title || !content || !coverImageUrl || typeof coverImageUrl !== "string") {
      return next(new ErrorHandler("Please provide all required fields (title, content, coverImage)", 400));
    }

    const parsedTags = parseTags(tags);
    const authorType = req.user?.role === "admin" ? "Admin" : "Nursery";

    const blog = await Blog.create({
      title,
      content,
      coverImage: coverImageUrl,
      tags: parsedTags,
      author: req.user?._id,
      authorType,
    });

    const excerpt = content.replace(/<[^>]*>/g, "").substring(0, 150) + "...";

    cacheManager.invalidatePattern("blogs:");

    sendNewBlogNotificationEmail({
      title: blog.title,
      slug: blog.slug,
      coverImage: blog.coverImage,
      excerpt: excerpt,
    }).catch((err) => console.error("Background email broadcast failed:", err));

    res.status(201).json({
      success: true,
      message: "Blog post published successfully",
      blog,
    });
  }
);

// ======================================================================
// 📖 2. GET SINGLE BLOG BY SLUG
// ======================================================================
export const getBlogBySlug = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawSlug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    if (!rawSlug) {
      return next(new ErrorHandler("Slug parameter is required", 400));
    }

    const cleanSlug = decodeURIComponent(String(rawSlug)).trim();

    // Query by cleanSlug with case-insensitive and exact match resilience
    // Ensure it doesn't fail if isPublished is boolean true or missing
    const query = {
      $or: [
        { slug: cleanSlug },
        { slug: cleanSlug.toLowerCase() },
        { slug: { $regex: new RegExp(`^${escapeRegexCharacters(cleanSlug)}$`, "i") } },
      ],
      $and: [
        {
          $or: [{ isPublished: true }, { isPublished: { $exists: false } }],
        },
      ],
    };

    const blog = await Blog.findOneAndUpdate(
      query,
      { $inc: { views: 1 } },
      { new: true }
    )
      .populate("author", "name email avatar")
      .lean();

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: `Blog post not found for slug: ${cleanSlug}`,
      });
    }

    return res.status(200).json({
      success: true,
      data: blog,
      blog,
    });
  }
);

// ======================================================================
// 🔍 3. GET SINGLE BLOG BY ID (For Admin / Direct Lookup)
// ======================================================================
export const getBlogById = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const blog = await Blog.findById(req.params.id)
      .populate("author", "name email avatar")
      .lean();

    if (!blog) {
      return next(new ErrorHandler("Blog post not found", 404));
    }

    res.status(200).json({
      success: true,
      blog,
    });
  }
);

// ======================================================================
// 📚 4. GET ALL BLOGS (With Search & Tag / Category Filters)
// ======================================================================
export const getAllBlogs = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const resPerPage = Number(req.query.limit) || 6;
    const page = Number(req.query.page) || 1;
    const skip = resPerPage * (page - 1);

    const keywordFilter = req.query.keyword
      ? {
          $or: [
            { title: { $regex: escapeRegexCharacters(String(req.query.keyword)), $options: "i" } },
            { content: { $regex: escapeRegexCharacters(String(req.query.keyword)), $options: "i" } },
          ],
        }
      : {};

    const tagFilter = req.query.tag
      ? { tags: { $in: [String(req.query.tag)] } }
      : {};

    const categoryFilter = req.query.category && req.query.category !== "All"
      ? { tags: { $in: [String(req.query.category)] } }
      : {};

    const filterQuery = {
      ...keywordFilter,
      ...tagFilter,
      ...categoryFilter,
    };

    // ⚡ PERF: Parallel query execution with .lean()
    const [blogs, totalBlogs] = await Promise.all([
      Blog.find(filterQuery)
        .populate("author", "name avatar")
        .sort({ createdAt: -1 })
        .limit(resPerPage)
        .skip(skip)
        .lean(),
      Blog.countDocuments(filterQuery),
    ]);

    res.status(200).json({
      success: true,
      count: blogs.length,
      totalBlogs,
      resPerPage,
      currentPage: page,
      totalPages: Math.ceil(totalBlogs / resPerPage) || 1,
      blogs,
    });
  }
);

// ======================================================================
// 🔄 5. UPDATE BLOG
// ======================================================================
export const updateBlog = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    let blog = await Blog.findById(req.params.id);

    if (!blog) {
      return next(new ErrorHandler("Blog post not found", 404));
    }

    if (req.user?.role !== "admin" && blog.author.toString() !== req.user?._id.toString()) {
      return next(new ErrorHandler("Unauthorized action. You cannot edit this post", 403));
    }

    const { title, content, coverImage, tags } = req.body;

    if (title) blog.title = title;
    if (content) blog.content = content;

    // Handle image file upload if uploaded
    if (req.files && req.files.coverImage) {
      const file = (Array.isArray(req.files.coverImage) ? req.files.coverImage[0] : req.files.coverImage) as UploadedFile;
      const uploaded = await cloudinary.v2.uploader.upload(file.tempFilePath, {
        folder: "urban-nursery/blogs",
      });
      blog.coverImage = uploaded.secure_url;
    } else if (typeof coverImage === "string" && coverImage.trim() !== "") {
      if (coverImage.startsWith("data:image")) {
        const uploaded = await cloudinary.v2.uploader.upload(coverImage, {
          folder: "urban-nursery/blogs",
        });
        blog.coverImage = uploaded.secure_url;
      } else {
        blog.coverImage = coverImage;
      }
    }

    if (tags !== undefined) {
      blog.tags = parseTags(tags);
    }

    await blog.save();
    cacheManager.invalidatePattern("blogs:");

    res.status(200).json({
      success: true,
      message: "Blog post updated successfully",
      blog,
    });
  }
);

// ======================================================================
// 🗑️ 6. DELETE BLOG
// ======================================================================
export const deleteBlog = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const blog = await Blog.findById(req.params.id);

    if (!blog) {
      return next(new ErrorHandler("Blog post not found", 404));
    }

    if (req.user?.role !== "admin" && blog.author.toString() !== req.user?._id.toString()) {
      return next(new ErrorHandler("Unauthorized action. You cannot delete this post", 403));
    }

    await blog.deleteOne();
    cacheManager.invalidatePattern("blogs:");

    res.status(200).json({
      success: true,
      message: "Blog post deleted successfully",
    });
  }
);