import { Request, Response, NextFunction } from "express";
import mongoose, { PipelineStage } from "mongoose";
import Product, { IProduct, ReviewStatus } from "../models/productModel";
import ErrorHandler from "../utils/errorHandler";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import { recalculateProductRatings } from "./productController";

const VALID_STATUSES: ReviewStatus[] = ["pending", "approved", "flagged", "rejected"];

/**
 * 🌟 GET GLOBAL REVIEWS MODERATION QUEUE
 * GET /api/v1/admin/reviews
 */
export const getAdminGlobalReviews = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawPage = Number(req.query.page) || 1;
    const rawLimit = Number(req.query.limit) || 20;
    const page = Math.max(1, rawPage);
    const limit = Math.min(100, Math.max(1, rawLimit));
    const skip = (page - 1) * limit;

    const status = req.query.status ? String(req.query.status).trim().toLowerCase() : "all";
    const ratingParam = req.query.rating ? String(req.query.rating).trim() : "all";
    const search = req.query.search ? String(req.query.search).trim() : "";
    const sortBy = req.query.sortBy ? String(req.query.sortBy).trim() : "createdAt:desc";

    // 1. Build unwound review filter criteria
    const matchFilter: Record<string, any> = {};

    if (status && status !== "all") {
      if (VALID_STATUSES.includes(status as ReviewStatus)) {
        matchFilter["reviews.status"] = status;
      }
    }

    if (ratingParam && ratingParam !== "all") {
      const parsedRating = Number(ratingParam);
      if (!isNaN(parsedRating) && parsedRating >= 1 && parsedRating <= 5) {
        matchFilter["reviews.rating"] = parsedRating;
      }
    }

    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      matchFilter.$or = [
        { "reviews.name": searchRegex },
        { "reviews.comment": searchRegex },
        { name: searchRegex },
        { "reviewer.name": searchRegex },
        { "reviewer.email": searchRegex },
      ];
    }

    // 2. Build sorting criteria
    let sortStage: Record<string, 1 | -1> = { "reviews.createdAt": -1, "reviews._id": -1 };
    if (sortBy === "createdAt:asc") {
      sortStage = { "reviews.createdAt": 1, "reviews._id": 1 };
    } else if (sortBy === "rating:desc") {
      sortStage = { "reviews.rating": -1, "reviews.createdAt": -1 };
    } else if (sortBy === "rating:asc") {
      sortStage = { "reviews.rating": 1, "reviews.createdAt": -1 };
    }

    // 3. Assemble MongoDB Aggregation Pipeline
    const pipeline: PipelineStage[] = [
      { $match: { "reviews.0": { $exists: true } } },
      { $unwind: "$reviews" },
      {
        $addFields: {
          "reviews.status": { $ifNull: ["$reviews.status", "approved"] },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "reviews.user",
          foreignField: "_id",
          as: "reviewer",
        },
      },
      {
        $unwind: {
          path: "$reviewer",
          preserveNullAndEmptyArrays: true,
        },
      },
    ];

    if (Object.keys(matchFilter).length > 0) {
      pipeline.push({ $match: matchFilter });
    }

    pipeline.push({
      $facet: {
        metadata: [{ $count: "total" }],
        data: [
          { $sort: sortStage },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: "$reviews._id",
              productId: "$_id",
              productName: "$name",
              productSlug: "$slug",
              productCategory: "$category",
              productImage: {
                $ifNull: [
                  "$coverImage.url",
                  { $arrayElemAt: ["$images.url", 0] },
                ],
              },
              productRatingsAverage: "$ratingsAverage",
              productRatingsQuantity: "$ratingsQuantity",
              rating: "$reviews.rating",
              comment: "$reviews.comment",
              status: "$reviews.status",
              isVerifiedBuyer: { $ifNull: ["$reviews.isVerifiedBuyer", false] },
              createdAt: "$reviews.createdAt",
              user: {
                _id: "$reviewer._id",
                name: { $ifNull: ["$reviewer.name", "$reviews.name"] },
                email: { $ifNull: ["$reviewer.email", "N/A"] },
                avatar: "$reviewer.avatar.url",
              },
            },
          },
        ],
      },
    });

    // 4. Concurrently calculate Platform Global Review KPIs
    const [aggregateResult, [kpiStats]] = await Promise.all([
      Product.aggregate(pipeline),
      Product.aggregate([
        { $match: { "reviews.0": { $exists: true } } },
        { $unwind: "$reviews" },
        {
          $addFields: {
            "reviews.status": { $ifNull: ["$reviews.status", "approved"] },
          },
        },
        {
          $group: {
            _id: null,
            totalReviews: { $sum: 1 },
            pendingReviews: {
              $sum: { $cond: [{ $eq: ["$reviews.status", "pending"] }, 1, 0] },
            },
            flaggedReviews: {
              $sum: { $cond: [{ $eq: ["$reviews.status", "flagged"] }, 1, 0] },
            },
            approvedReviews: {
              $sum: { $cond: [{ $eq: ["$reviews.status", "approved"] }, 1, 0] },
            },
            rejectedReviews: {
              $sum: { $cond: [{ $eq: ["$reviews.status", "rejected"] }, 1, 0] },
            },
            totalRatingSum: {
              $sum: {
                $cond: [
                  { $ne: ["$reviews.status", "rejected"] },
                  "$reviews.rating",
                  0,
                ],
              },
            },
            validRatingCount: {
              $sum: {
                $cond: [
                  { $ne: ["$reviews.status", "rejected"] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const metadata = aggregateResult[0]?.metadata?.[0];
    const totalCount = metadata?.total || 0;
    const reviews = aggregateResult[0]?.data || [];
    const totalPages = Math.ceil(totalCount / limit) || 1;

    const avgPlatformRating =
      kpiStats?.validRatingCount && kpiStats.validRatingCount > 0
        ? Math.round((kpiStats.totalRatingSum / kpiStats.validRatingCount) * 10) / 10
        : 0;

    res.status(200).json({
      success: true,
      reviews,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      stats: {
        totalReviews: kpiStats?.totalReviews || 0,
        pendingReviews: kpiStats?.pendingReviews || 0,
        flaggedReviews: kpiStats?.flaggedReviews || 0,
        approvedReviews: kpiStats?.approvedReviews || 0,
        rejectedReviews: kpiStats?.rejectedReviews || 0,
        avgRating: avgPlatformRating,
      },
    });
  }
);

/**
 * 🛡️ UPDATE REVIEW STATUS (APPROVE / FLAG / REJECT / PENDING)
 * PATCH /api/v1/admin/reviews/:id/status
 */
export const updateReviewStatus = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId);
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new ErrorHandler("Invalid review ID format.", 400));
    }

    if (!status || !VALID_STATUSES.includes(status as ReviewStatus)) {
      return next(
        new ErrorHandler(
          `Invalid status. Status must be one of: ${VALID_STATUSES.join(", ")}`,
          400
        )
      );
    }

    const reviewObjectId = new mongoose.Types.ObjectId(id);
    const product = await Product.findOne({ "reviews._id": reviewObjectId });

    if (!product) {
      return next(new ErrorHandler("Review or associated product not found.", 404));
    }

    const targetReview = product.reviews.find(
      (r) => r._id?.toString() === reviewObjectId.toString()
    );

    if (!targetReview) {
      return next(new ErrorHandler("Review not found inside product document.", 404));
    }

    // Update status
    targetReview.status = status as ReviewStatus;

    // Recalculate parent product rating metrics
    recalculateProductRatings(product);

    await product.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: `Review status successfully updated to "${status}".`,
      review: targetReview,
      product: {
        _id: product._id,
        name: product.name,
        ratingsAverage: product.ratingsAverage,
        ratingsQuantity: product.ratingsQuantity,
      },
    });
  }
);

/**
 * 🗑️ ADMIN PURGE REVIEW RECORD
 * DELETE /api/v1/admin/reviews/:id
 */
export const deleteAdminReview = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new ErrorHandler("Invalid review ID format.", 400));
    }

    const reviewObjectId = new mongoose.Types.ObjectId(id);
    const product = await Product.findOne({ "reviews._id": reviewObjectId });

    if (!product) {
      return next(new ErrorHandler("Review or associated product not found.", 404));
    }

    const reviewIndex = product.reviews.findIndex(
      (r) => r._id?.toString() === reviewObjectId.toString()
    );

    if (reviewIndex === -1) {
      return next(new ErrorHandler("Review not found inside product document.", 404));
    }

    // Remove review and recalculate metrics
    product.reviews.splice(reviewIndex, 1);
    recalculateProductRatings(product);

    await product.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: "Review successfully purged from catalog.",
      product: {
        _id: product._id,
        name: product.name,
        ratingsAverage: product.ratingsAverage,
        ratingsQuantity: product.ratingsQuantity,
      },
    });
  }
);

/**
 * ⚡ BULK MODERATE REVIEWS (APPROVE / REJECT / FLAG MULTIPLE)
 * PATCH /api/v1/admin/reviews/bulk-status
 */
export const bulkUpdateReviewStatus = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { reviewIds, status } = req.body;

    if (!Array.isArray(reviewIds) || reviewIds.length === 0) {
      return next(new ErrorHandler("reviewIds array is required.", 400));
    }

    if (!status || !VALID_STATUSES.includes(status as ReviewStatus)) {
      return next(
        new ErrorHandler(
          `Invalid status. Status must be one of: ${VALID_STATUSES.join(", ")}`,
          400
        )
      );
    }

    const validObjectIds = reviewIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (validObjectIds.length === 0) {
      return next(new ErrorHandler("No valid review IDs provided.", 400));
    }

    // Locate all products containing any of the review IDs
    const products = await Product.find({
      "reviews._id": { $in: validObjectIds },
    });

    let updatedReviewsCount = 0;

    for (const product of products) {
      let productModified = false;
      for (const review of product.reviews) {
        if (
          review._id &&
          validObjectIds.some((id) => id.toString() === review._id?.toString())
        ) {
          review.status = status as ReviewStatus;
          productModified = true;
          updatedReviewsCount++;
        }
      }

      if (productModified) {
        recalculateProductRatings(product);
        await product.save({ validateBeforeSave: false });
      }
    }

    res.status(200).json({
      success: true,
      message: `Successfully updated ${updatedReviewsCount} reviews to "${status}".`,
      updatedCount: updatedReviewsCount,
    });
  }
);
