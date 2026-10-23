import { Request, Response, NextFunction } from "express";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import BulkOrder from "../models/BulkOrder";
import {
  BULK_ORDER_STATUSES,
  BULK_ORDER_PRODUCT_TYPES,
  BulkOrderStatus,
  BulkOrderProductType,
} from "../types/bulkOrder.types";
import {
  sendAdminBulkOrderAlert,
  sendCustomerBulkOrderConfirmation,
} from "../templates/emails";

// ======================================================================
// 📥 1. CREATE BULK ORDER INQUIRY (Public Endpoint)
// ======================================================================
export const createBulkOrder = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      fullName,
      name, // Fallback for backwards compatibility
      phoneNumber,
      phone, // Fallback for backwards compatibility
      email,
      city,
      state,
      productType,
      productCategory, // Fallback for backwards compatibility
      estimatedQuantity,
      message,
      requirements, // Fallback for backwards compatibility
    } = req.body;

    // Normalization & Fallbacks
    const resolvedFullName = (fullName || name || "").trim();
    const resolvedPhoneNumber = (phoneNumber || phone || "").trim();
    const resolvedCity = (city || "").trim();
    const resolvedState = (state || "").trim();
    const rawProductType = (productType || productCategory || "").toLowerCase().trim();
    const resolvedMessage = (message || requirements || "").trim();
    const parsedQuantity = Number(estimatedQuantity);

    // Strict validation of mandatory fields
    if (!resolvedFullName) {
      return next(new ErrorHandler("Full name is required", 400));
    }
    if (!resolvedPhoneNumber) {
      return next(new ErrorHandler("Phone number is required", 400));
    }
    if (!resolvedCity) {
      return next(new ErrorHandler("City is required", 400));
    }
    if (!resolvedState) {
      return next(new ErrorHandler("State is required", 400));
    }
    if (!rawProductType) {
      return next(new ErrorHandler("Product category/type is required", 400));
    }
    if (!BULK_ORDER_PRODUCT_TYPES.includes(rawProductType as BulkOrderProductType)) {
      return next(
        new ErrorHandler(
          `Invalid product type. Must be one of: ${BULK_ORDER_PRODUCT_TYPES.join(", ")}`,
          400
        )
      );
    }
    if (!parsedQuantity || isNaN(parsedQuantity) || parsedQuantity < 1) {
      return next(new ErrorHandler("Estimated quantity must be a valid number of at least 1", 400));
    }

    // Persist to MongoDB
    const bulkOrder = await BulkOrder.create({
      fullName: resolvedFullName,
      phoneNumber: resolvedPhoneNumber,
      email: email ? email.trim().toLowerCase() : undefined,
      city: resolvedCity,
      state: resolvedState,
      productType: rawProductType as BulkOrderProductType,
      estimatedQuantity: parsedQuantity,
      message: resolvedMessage,
      status: "Pending",
    });

    // Non-blocking email dispatch with full error handling
    sendAdminBulkOrderAlert(bulkOrder).catch((err) =>
      console.error("❌ [Email Trigger Failed] Event: AdminBulkOrderAlert, Error:", err?.message || err)
    );

    if (bulkOrder.email) {
      sendCustomerBulkOrderConfirmation(bulkOrder).catch((err) =>
        console.error("❌ [Email Trigger Failed] Event: CustomerBulkOrderConfirmation, Error:", err?.message || err)
      );
    }

    res.status(201).json({
      success: true,
      message: "Bulk order inquiry submitted successfully!",
      bulkOrder,
    });
  }
);

// Backward-compatible alias
export const createBulkOrderInquiry = createBulkOrder;

// ======================================================================
// 🛡️ 2. ADMIN: GET ALL BULK ORDER INQUIRIES (Paginated, Search & Filtered)
// ======================================================================
export const getAllBulkOrders = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const resPerPage = Math.max(1, Number(req.query.limit) || 10);
    const page = Math.max(1, Number(req.query.page) || 1);
    const skip = resPerPage * (page - 1);

    const filter: Record<string, any> = {};

    // Filter by status if provided and not "all"
    if (req.query.status && req.query.status !== "all") {
      filter.status = req.query.status;
    }

    // Filter by productType / category if provided and not "all"
    if (req.query.productType && req.query.productType !== "all") {
      filter.productType = (req.query.productType as string).toLowerCase();
    } else if (req.query.category && req.query.category !== "all") {
      filter.productType = (req.query.category as string).toLowerCase();
    }

    // Search query on fullName, city, state, phoneNumber, or email
    if (req.query.search && typeof req.query.search === "string" && req.query.search.trim()) {
      const searchRegex = new RegExp(req.query.search.trim(), "i");
      filter.$or = [
        { fullName: searchRegex },
        { phoneNumber: searchRegex },
        { email: searchRegex },
        { city: searchRegex },
        { state: searchRegex },
      ];
    }

    const [bulkOrders, totalBulkOrders] = await Promise.all([
      BulkOrder.find(filter)
        .sort({ createdAt: -1 })
        .limit(resPerPage)
        .skip(skip)
        .lean(),
      BulkOrder.countDocuments(filter),
    ]);

    // Metrics aggregation for admin dashboard summary
    const [pendingCount, inDiscussionCount, quotedCount, fulfilledCount, cancelledCount] =
      await Promise.all([
        BulkOrder.countDocuments({ status: "Pending" }),
        BulkOrder.countDocuments({ status: "In Discussion" }),
        BulkOrder.countDocuments({ status: "Quoted" }),
        BulkOrder.countDocuments({ status: "Fulfilled" }),
        BulkOrder.countDocuments({ status: "Cancelled" }),
      ]);

    res.status(200).json({
      success: true,
      count: bulkOrders.length,
      totalBulkOrders,
      totalPages: Math.ceil(totalBulkOrders / resPerPage) || 1,
      currentPage: page,
      stats: {
        total: await BulkOrder.countDocuments(),
        pending: pendingCount,
        inDiscussion: inDiscussionCount,
        quoted: quotedCount,
        fulfilled: fulfilledCount,
        cancelled: cancelledCount,
      },
      bulkOrders,
    });
  }
);

// ======================================================================
// 🛡️ 3. ADMIN: GET SINGLE BULK ORDER DETAILS
// ======================================================================
export const getBulkOrderDetails = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const bulkOrder = await BulkOrder.findById(req.params.id);

    if (!bulkOrder) {
      return next(new ErrorHandler("Bulk order inquiry not found", 404));
    }

    res.status(200).json({
      success: true,
      bulkOrder,
    });
  }
);

// ======================================================================
// 🛡️ 4. ADMIN: UPDATE BULK ORDER STATUS & ADMIN NOTES
// ======================================================================
export const updateBulkOrderStatus = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { status, adminNotes } = req.body;

    const bulkOrder = await BulkOrder.findById(req.params.id);

    if (!bulkOrder) {
      return next(new ErrorHandler("Bulk order inquiry not found", 404));
    }

    if (status) {
      if (!BULK_ORDER_STATUSES.includes(status as BulkOrderStatus)) {
        return next(
          new ErrorHandler(
            `Invalid status provided. Must be one of: ${BULK_ORDER_STATUSES.join(", ")}`,
            400
          )
        );
      }
      bulkOrder.status = status as BulkOrderStatus;
    }

    if (adminNotes !== undefined) {
      bulkOrder.adminNotes = adminNotes;
    }

    await bulkOrder.save();

    res.status(200).json({
      success: true,
      message: "Bulk order status updated successfully",
      bulkOrder,
    });
  }
);

// ======================================================================
// 🛡️ 5. ADMIN: DELETE BULK ORDER INQUIRY
// ======================================================================
export const deleteBulkOrder = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const bulkOrder = await BulkOrder.findById(req.params.id);

    if (!bulkOrder) {
      return next(new ErrorHandler("Bulk order inquiry not found", 404));
    }

    await bulkOrder.deleteOne();

    res.status(200).json({
      success: true,
      message: "Bulk order inquiry deleted successfully",
    });
  }
);