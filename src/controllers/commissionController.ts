import { Request, Response, NextFunction } from "express";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import CategoryCommission, { ICategoryCommission } from "../models/categoryCommissionModel";
import {
  DEFAULT_CATEGORY_COMMISSIONS,
  clearCommissionCache,
  getActiveCommissionMap,
} from "../utils/commissionService";

// ======================================================================
// 1. GET ALL CATEGORY COMMISSIONS (PUBLIC & ADMIN WITH AUTO-SEED)
// ======================================================================
export const getAllCategoryCommissions = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    // 🛡️ Automatic verification and self-healing seed if table is uninitialized
    const count = await CategoryCommission.countDocuments();
    if (count === 0) {
      console.log("[commissionController] CategoryCommission collection empty. Auto-seeding 8 categories...");
      await CategoryCommission.insertMany(DEFAULT_CATEGORY_COMMISSIONS);
      clearCommissionCache();
    } else if (count < DEFAULT_CATEGORY_COMMISSIONS.length) {
      for (const def of DEFAULT_CATEGORY_COMMISSIONS) {
        const found = await CategoryCommission.findOne({ category: def.category });
        if (!found) {
          await CategoryCommission.create(def);
        }
      }
      clearCommissionCache();
    }

    const commissions = await CategoryCommission.find()
      .populate("updatedBy", "name email")
      .sort({ category: 1 });

    res.status(200).json({
      success: true,
      count: commissions.length,
      commissions,
      data: commissions,
    });
  }
);

// ======================================================================
// 2. CREATE NEW CATEGORY COMMISSION (ADMIN ONLY)
// ======================================================================
export const createCategoryCommission = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    const { category, itemModel, commissionPercentage, description } = req.body;

    if (!category || !itemModel || commissionPercentage === undefined) {
      return next(
        new ErrorHandler("Category name, item model, and commission percentage are required.", 400)
      );
    }

    const trimmedCategory = String(category).trim();
    const existing = await CategoryCommission.findOne({
      $or: [{ category: trimmedCategory }, { itemModel: String(itemModel).trim() }],
    });

    if (existing) {
      return next(
        new ErrorHandler(
          `Commission configuration already exists for category "${existing.category}" (${existing.itemModel}).`,
          400
        )
      );
    }

    const parsedRate = Number(commissionPercentage);
    if (isNaN(parsedRate) || parsedRate < 0 || parsedRate > 100) {
      return next(
        new ErrorHandler("Commission percentage must be a valid number between 0 and 100.", 400)
      );
    }

    const newCommission = await CategoryCommission.create({
      category: trimmedCategory,
      itemModel: String(itemModel).trim(),
      commissionPercentage: parsedRate,
      description: description ? String(description).trim() : undefined,
      updatedBy: req.user?._id,
    });

    clearCommissionCache();

    res.status(201).json({
      success: true,
      message: `Commission rate for "${newCommission.category}" successfully created at ${newCommission.commissionPercentage}%.`,
      commission: newCommission,
      data: newCommission,
    });
  }
);

// ======================================================================
// 3. UPDATE SINGLE CATEGORY COMMISSION (ADMIN ONLY)
// ======================================================================
export const updateCategoryCommission = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { commissionPercentage, description, category, itemModel } = req.body;

    const commissionDoc = await CategoryCommission.findById(id);
    if (!commissionDoc) {
      return next(new ErrorHandler("Commission configuration record not found.", 404));
    }

    if (commissionPercentage !== undefined) {
      const parsedRate = Number(commissionPercentage);
      if (isNaN(parsedRate) || parsedRate < 0 || parsedRate > 100) {
        return next(
          new ErrorHandler("Commission percentage must be a valid number between 0 and 100.", 400)
        );
      }
      commissionDoc.commissionPercentage = parsedRate;
    }

    if (description !== undefined) {
      commissionDoc.description = String(description).trim();
    }

    if (category) {
      commissionDoc.category = String(category).trim();
    }

    if (itemModel) {
      commissionDoc.itemModel = String(itemModel).trim();
    }

    commissionDoc.updatedBy = req.user?._id;
    await commissionDoc.save();

    clearCommissionCache();

    res.status(200).json({
      success: true,
      message: `Commission rate for "${commissionDoc.category}" updated to ${commissionDoc.commissionPercentage}%.`,
      commission: commissionDoc,
      data: commissionDoc,
    });
  }
);

// ======================================================================
// 4. BATCH / BULK UPDATE MULTIPLE CATEGORY COMMISSIONS (ADMIN ONLY)
// ======================================================================
export const bulkUpdateCategoryCommissions = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    const { commissions } = req.body;

    if (!Array.isArray(commissions) || commissions.length === 0) {
      return next(
        new ErrorHandler("Payload must include a non-empty array of commission update objects.", 400)
      );
    }

    const updatedRecords: ICategoryCommission[] = [];

    for (const item of commissions) {
      const targetId = item._id || item.id;
      if (!targetId) continue;

      const doc = await CategoryCommission.findById(targetId);
      if (!doc) continue;

      if (item.commissionPercentage !== undefined) {
        const rate = Number(item.commissionPercentage);
        if (!isNaN(rate) && rate >= 0 && rate <= 100) {
          doc.commissionPercentage = rate;
        }
      }

      if (item.description !== undefined) {
        doc.description = String(item.description).trim();
      }

      doc.updatedBy = req.user?._id;
      await doc.save();
      updatedRecords.push(doc);
    }

    clearCommissionCache();

    res.status(200).json({
      success: true,
      message: `Successfully synchronized ${updatedRecords.length} category commission slabs.`,
      updatedCount: updatedRecords.length,
      commissions: updatedRecords,
      data: updatedRecords,
    });
  }
);

// ======================================================================
// 5. RESET DEFAULT COMMISSIONS (ADMIN ONLY)
// ======================================================================
export const resetDefaultCommissions = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    await CategoryCommission.deleteMany({});
    const seeded = await CategoryCommission.insertMany(
      DEFAULT_CATEGORY_COMMISSIONS.map((c) => ({
        ...c,
        updatedBy: req.user?._id,
      }))
    );

    clearCommissionCache();

    res.status(200).json({
      success: true,
      message: "Successfully reset category commission slabs to platform statutory defaults.",
      count: seeded.length,
      commissions: seeded,
      data: seeded,
    });
  }
);

// ======================================================================
// 6. DELETE CATEGORY COMMISSION (ADMIN ONLY)
// ======================================================================
export const deleteCategoryCommission = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const doc = await CategoryCommission.findById(id);

    if (!doc) {
      return next(new ErrorHandler("Category commission record not found.", 404));
    }

    await doc.deleteOne();
    clearCommissionCache();

    res.status(200).json({
      success: true,
      message: `Commission configuration for "${doc.category}" has been deleted.`,
    });
  }
);
