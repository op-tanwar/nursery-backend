import { Request, Response, NextFunction } from "express";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import CategoryTax, { ICategoryTax } from "../models/categoryTaxModel";
import {
  DEFAULT_CATEGORY_TAXES,
  clearTaxCache,
  getActiveTaxMap,
} from "../utils/taxService";

// ======================================================================
// 1. GET ALL CATEGORY TAXES (PUBLIC & ADMIN ACCESSIBLE WITH AUTO-SEED)
// ======================================================================
export const getAllCategoryTaxes = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    // 🛡️ Automatic verification and self-healing seed if table is uninitialized
    const count = await CategoryTax.countDocuments();
    if (count === 0) {
      console.log("[taxController] CategoryTax collection is empty. Auto-seeding default 8 categories...");
      await CategoryTax.insertMany(DEFAULT_CATEGORY_TAXES);
      clearTaxCache();
    } else if (count < DEFAULT_CATEGORY_TAXES.length) {
      // Ensure any missing default categories are created
      for (const def of DEFAULT_CATEGORY_TAXES) {
        const found = await CategoryTax.findOne({ category: def.category });
        if (!found) {
          await CategoryTax.create(def);
        }
      }
      clearTaxCache();
    }

    const taxes = await CategoryTax.find()
      .populate("updatedBy", "name email")
      .sort({ category: 1 });

    res.status(200).json({
      success: true,
      count: taxes.length,
      taxes,
      data: taxes,
    });
  }
);

// ======================================================================
// 2. CREATE NEW CATEGORY TAX (ADMIN ONLY)
// ======================================================================
export const createCategoryTax = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    const { category, itemModel, taxPercentage, isTaxInclusive, description } = req.body;

    if (!category || !itemModel || taxPercentage === undefined) {
      return next(
        new ErrorHandler("Category name, item model, and tax percentage are required.", 400)
      );
    }

    const trimmedCategory = String(category).trim();
    const existing = await CategoryTax.findOne({
      $or: [{ category: trimmedCategory }, { itemModel: String(itemModel).trim() }],
    });

    if (existing) {
      return next(
        new ErrorHandler(
          `Tax configuration already exists for category "${existing.category}" (${existing.itemModel}).`,
          400
        )
      );
    }

    const parsedRate = Number(taxPercentage);
    if (isNaN(parsedRate) || parsedRate < 0 || parsedRate > 100) {
      return next(new ErrorHandler("Tax percentage must be a valid number between 0 and 100.", 400));
    }

    const newTax = await CategoryTax.create({
      category: trimmedCategory,
      itemModel: String(itemModel).trim(),
      taxPercentage: parsedRate,
      isTaxInclusive: Boolean(isTaxInclusive),
      description: description ? String(description).trim() : undefined,
      updatedBy: req.user?._id,
    });

    clearTaxCache();

    res.status(201).json({
      success: true,
      message: `Tax rate for category "${newTax.category}" successfully created at ${newTax.taxPercentage}%.`,
      tax: newTax,
      data: newTax,
    });
  }
);

// ======================================================================
// 3. UPDATE SINGLE CATEGORY TAX (ADMIN ONLY)
// ======================================================================
export const updateCategoryTax = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { taxPercentage, isTaxInclusive, description } = req.body;

    let tax = await CategoryTax.findById(id);
    if (!tax) {
      tax = await CategoryTax.findOne({
        $or: [{ category: id }, { itemModel: id }],
      });
    }

    if (!tax) {
      return next(new ErrorHandler(`Tax configuration not found for identifier: ${id}`, 404));
    }

    if (taxPercentage !== undefined) {
      const parsedRate = Number(taxPercentage);
      if (isNaN(parsedRate) || parsedRate < 0 || parsedRate > 100) {
        return next(new ErrorHandler("Tax percentage must be a valid number between 0 and 100.", 400));
      }
      tax.taxPercentage = parsedRate;
    }

    if (isTaxInclusive !== undefined) {
      tax.isTaxInclusive = Boolean(isTaxInclusive);
    }

    if (description !== undefined) {
      tax.description = String(description).trim();
    }

    tax.updatedBy = req.user?._id;
    await tax.save();

    clearTaxCache();

    res.status(200).json({
      success: true,
      message: `Tax rate for category "${tax.category}" updated to ${tax.taxPercentage}% (${tax.isTaxInclusive ? "Tax Inclusive" : "Tax Exclusive"}).`,
      tax,
      data: tax,
    });
  }
);

// ======================================================================
// 4. BULK UPDATE CATEGORY TAXES (ADMIN ONLY: PATCH /api/v1/taxes)
// ======================================================================
export const bulkUpdateCategoryTaxes = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    const { taxes } = req.body;

    if (!Array.isArray(taxes) || taxes.length === 0) {
      return next(new ErrorHandler("Taxes array payload required for bulk update.", 400));
    }

    const updatedTaxes: any[] = [];

    for (const item of taxes) {
      const identifier = item._id || item.id || item.category || item.itemModel;
      if (!identifier) continue;

      let taxDoc = await CategoryTax.findOne({
        $or: [{ _id: identifier }, { category: identifier }, { itemModel: identifier }],
      });

      if (taxDoc) {
        if (item.taxPercentage !== undefined) {
          const rate = Number(item.taxPercentage);
          if (!isNaN(rate) && rate >= 0 && rate <= 100) {
            taxDoc.taxPercentage = rate;
          }
        }

        if (item.isTaxInclusive !== undefined) {
          taxDoc.isTaxInclusive = Boolean(item.isTaxInclusive);
        }

        if (item.description !== undefined) {
          taxDoc.description = String(item.description).trim();
        }

        taxDoc.updatedBy = req.user?._id;
        await taxDoc.save();
        updatedTaxes.push(taxDoc);
      }
    }

    clearTaxCache();

    res.status(200).json({
      success: true,
      message: `Successfully updated ${updatedTaxes.length} category tax configurations.`,
      taxes: updatedTaxes,
      data: updatedTaxes,
    });
  }
);

// ======================================================================
// 5. RESET DEFAULT TAX RATES (ADMIN ONLY: POST /api/v1/taxes/reset)
// ======================================================================
export const resetDefaultTaxes = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    await CategoryTax.deleteMany({});
    await CategoryTax.insertMany(
      DEFAULT_CATEGORY_TAXES.map((dt) => ({
        ...dt,
        updatedBy: req.user?._id,
      }))
    );

    clearTaxCache();
    const freshTaxes = await CategoryTax.find().sort({ category: 1 });

    res.status(200).json({
      success: true,
      message: "Reset category taxes to standard platform defaults.",
      taxes: freshTaxes,
      data: freshTaxes,
    });
  }
);

// ======================================================================
// 6. DELETE CATEGORY TAX (ADMIN ONLY)
// ======================================================================
export const deleteCategoryTax = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const tax = await CategoryTax.findById(id);

    if (!tax) {
      return next(new ErrorHandler(`Tax configuration not found for ID: ${id}`, 404));
    }

    await tax.deleteOne();
    clearTaxCache();

    res.status(200).json({
      success: true,
      message: `Tax rule for category "${tax.category}" removed successfully.`,
    });
  }
);
