import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import cloudinary from "cloudinary";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import ReturnRequest from "../models/returnRequestModel";
import Order from "../models/orderModel";
import { UploadedFile } from "express-fileupload";
import { cleanupTempFile } from "../utils/uploadHelper";
import { ReturnRequestStatus } from "../types/returnRequest.types";
import {
  sendReturnRequestCreatedEmails,
  sendReturnRequestStatusUpdateEmail,
} from "../services/emailService";

const MAX_RETURN_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 Hours in Milliseconds

// ======================================================================
// 1. CUSTOMER: CREATE RETURN / REPLACEMENT REQUEST (POST /api/v1/returns/create)
// ======================================================================
export const createReturnRequest = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      orderId,
      orderItemId,
      productId,
      requestType,
      reason,
      description,
      productName,
      productModel,
      productImage,
    } = req.body;

    // ── Field Validations ──
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return next(new ErrorHandler("Valid order ID is required.", 400));
    }

    if (!orderItemId && !productId) {
      return next(new ErrorHandler("Target item reference is required.", 400));
    }

    if (!["Return", "Replacement"].includes(requestType)) {
      return next(new ErrorHandler("Request type must be 'Return' or 'Replacement'.", 400));
    }

    const validReasons = [
      "Damaged Plant/Pot",
      "Wrong Item Received",
      "Poor Plant Quality",
      "Other",
    ];
    if (!validReasons.includes(reason)) {
      return next(
        new ErrorHandler(
          `Invalid reason. Allowed: ${validReasons.join(", ")}`,
          400
        )
      );
    }

    if (!description || typeof description !== "string" || description.trim().length < 20) {
      return next(
        new ErrorHandler(
          "Detailed description must be at least 20 characters long.",
          400
        )
      );
    }

    // ── Fetch Order & Ownership Verification ──
    const order = await Order.findById(orderId);
    if (!order) {
      return next(new ErrorHandler("Order not found.", 404));
    }

    const currentUserId = req.user?._id?.toString();
    if (order.user?.toString() !== currentUserId) {
      return next(new ErrorHandler("You are not authorized to file returns for this order.", 403));
    }

    // ── Delivery Status & 24-Hour Rule Guard ──
    if (order.orderStatus !== "Delivered") {
      return next(
        new ErrorHandler(
          "Return or replacement requests can only be submitted for delivered orders.",
          400
        )
      );
    }

    if (!order.deliveredAt) {
      return next(
        new ErrorHandler(
          "Order delivery timestamp is missing. Please contact support to verify delivery status.",
          400
        )
      );
    }

    const deliveredTimestamp = new Date(order.deliveredAt).getTime();
    const timeSinceDelivery = Date.now() - deliveredTimestamp;

    if (timeSinceDelivery > MAX_RETURN_WINDOW_MS) {
      const hoursPassed = Math.floor(timeSinceDelivery / (1000 * 60 * 60));
      return next(
        new ErrorHandler(
          `The 24-hour return/replacement request window has expired (${hoursPassed} hours since delivery). Policy permits requests strictly within 24 hours.`,
          400
        )
      );
    }

    // ── Identify Target Order Item ──
    const targetItem = order.orderItems.find((item: any) => {
      const itemIdStr = item._id?.toString();
      const productRefStr = item.item?.toString();
      return (
        (orderItemId && itemIdStr === orderItemId) ||
        (orderItemId && productRefStr === orderItemId) ||
        (productId && productRefStr === productId) ||
        (productId && itemIdStr === productId)
      );
    });

    if (!targetItem) {
      return next(
        new ErrorHandler("Specified product item not found in this order sequence.", 404)
      );
    }

    const effectiveItemId = targetItem._id || new mongoose.Types.ObjectId();
    const effectiveProductId =
      targetItem.item || (productId ? new mongoose.Types.ObjectId(productId) : effectiveItemId);
    const effectiveNurseryId =
      targetItem.nursery || req.user?._id;

    // ── Check if Duplicate Request Already Exists ──
    const existing = await ReturnRequest.findOne({
      order: order._id,
      orderItem: effectiveItemId,
    });

    if (existing) {
      return next(
        new ErrorHandler(
          `A ${existing.requestType} request has already been registered for this item (Status: ${existing.status}).`,
          400
        )
      );
    }

    // ── Proof Images Handling (Files via multipart or URLs/Base64 in body) ──
    const uploadedProofUrls: string[] = [];

    // 1. Files uploaded via express-fileupload
    if (req.files && Object.keys(req.files).length > 0) {
      const fileList: UploadedFile[] = [];

      Object.values(req.files).forEach((f) => {
        if (Array.isArray(f)) {
          fileList.push(...f);
        } else if (f) {
          fileList.push(f);
        }
      });

      for (const file of fileList.slice(0, 3)) {
        try {
          const uploaded = await cloudinary.v2.uploader.upload(file.tempFilePath, {
            folder: "urban_nursery_returns",
            resource_type: "image",
          });
          if (uploaded.secure_url) {
            uploadedProofUrls.push(uploaded.secure_url);
          }
        } catch (uploadErr: any) {
          console.error("[Return Upload Error]:", uploadErr?.message || uploadErr);
        } finally {
          cleanupTempFile(file.tempFilePath);
        }
      }
    }

    // 2. Direct URLs or Base64 provided in body.proofImages
    if (req.body.proofImages) {
      let rawProofs = req.body.proofImages;
      if (typeof rawProofs === "string") {
        try {
          rawProofs = JSON.parse(rawProofs);
        } catch {
          rawProofs = [rawProofs];
        }
      }

      if (Array.isArray(rawProofs)) {
        for (const item of rawProofs.slice(0, 3)) {
          if (typeof item === "string" && item.trim()) {
            if (item.startsWith("data:image")) {
              try {
                const uploaded = await cloudinary.v2.uploader.upload(item, {
                  folder: "urban_nursery_returns",
                });
                uploadedProofUrls.push(uploaded.secure_url);
              } catch (b64Err: any) {
                console.error("[Return Base64 Upload Error]:", b64Err?.message);
              }
            } else if (item.startsWith("http")) {
              uploadedProofUrls.push(item);
            }
          }
        }
      }
    }

    if (uploadedProofUrls.length === 0) {
      return next(
        new ErrorHandler(
          "At least one proof photograph (e.g. photo of damaged packaging or plant) is required.",
          400
        )
      );
    }

    // ── Create authoritative ReturnRequest record ──
    const returnReq = await ReturnRequest.create({
      order: order._id,
      orderItem: effectiveItemId,
      product: effectiveProductId,
      productModel: productModel || targetItem.itemModel || "Plant",
      productName: productName || (targetItem as any).name || "Botanical Item",
      productImage: productImage || (targetItem as any).coverImage?.url || uploadedProofUrls[0],
      user: req.user?._id,
      nursery: effectiveNurseryId,
      requestType,
      reason,
      description: description.trim(),
      proofImages: uploadedProofUrls,
      status: "Pending",
    });

    // ── Sync with Order document legacy claim fields for backward compatibility ──
    targetItem.claim = {
      isClaimed: true,
      claimType: requestType === "Return" ? "Refund" : "Replacement",
      reason,
      proofUrl: uploadedProofUrls[0],
      status: "Pending",
      claimedAt: new Date(),
    };
    await order.save();

    // 📧 Fire-and-forget: Customer confirmation, Nursery alert, and Admin dispute alert
    sendReturnRequestCreatedEmails(returnReq._id.toString()).catch((err) =>
      console.error("[EMAIL ERROR] Type: RETURN_REQUEST_PIPELINE | Error:", err?.message || err)
    );

    res.status(201).json({
      success: true,
      message: `${requestType} request submitted successfully. Our team and nursery partner will review it within 24-48 hours.`,
      returnRequest: returnReq,
    });
  }
);

// ======================================================================
// 2. CENTRAL ADMIN: GET ALL RETURN REQUESTS (GET /api/v1/returns/admin/all)
// ======================================================================
export const getAllReturnRequestsAdmin = catchAsyncErrors(
  async (req: Request, res: Response) => {
    const { status, type } = req.query;

    const filter: Record<string, any> = {};
    if (status && typeof status === "string" && status !== "all") {
      filter.status = status;
    }
    if (type && typeof type === "string" && type !== "all") {
      filter.requestType = type;
    }

    const requests = await ReturnRequest.find(filter)
      .populate("user", "name email phone avatar")
      .populate("nursery", "name email businessName")
      .populate("order", "orderStatus deliveredAt createdAt shippingInfo totalPrice")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: requests.length,
      requests,
    });
  }
);

// ======================================================================
// 3. CENTRAL ADMIN: UPDATE STATUS & COMMENTS (PATCH /api/v1/returns/admin/:id/status)
// ======================================================================
export const updateReturnRequestStatusAdmin = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId || "");
    const { status, adminComments } = req.body;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return next(new ErrorHandler("Invalid Return Request ID.", 400));
    }

    const validStatuses: ReturnRequestStatus[] = ["Pending", "Approved", "Rejected", "Completed"];
    if (!status || !validStatuses.includes(status)) {
      return next(
        new ErrorHandler(
          `Invalid status. Allowed values: ${validStatuses.join(", ")}`,
          400
        )
      );
    }

    const returnReq = await ReturnRequest.findById(id);
    if (!returnReq) {
      return next(new ErrorHandler("Return request record not found.", 404));
    }

    returnReq.status = status;
    if (typeof adminComments === "string") {
      returnReq.adminComments = adminComments.trim();
    }
    await returnReq.save();

    // Sync status back to corresponding Order document
    try {
      const order = await Order.findById(returnReq.order);
      if (order) {
        const item = order.orderItems.find(
          (i: any) =>
            i._id?.toString() === returnReq.orderItem?.toString() ||
            i.item?.toString() === returnReq.product?.toString()
        );
        if (item && item.claim) {
          item.claim.status = status === "Completed" ? "Approved" : status;
          await order.save();
        }
      }
    } catch (orderSyncErr: any) {
      console.error("[Order Sync Error]:", orderSyncErr?.message);
    }

    // 📧 Fire-and-forget: Customer resolution update (Approved / Rejected / Completed)
    sendReturnRequestStatusUpdateEmail(returnReq._id.toString()).catch((err) =>
      console.error("[EMAIL ERROR] Type: RETURN_STATUS_UPDATE | Error:", err?.message || err)
    );

    res.status(200).json({
      success: true,
      message: `Return request status updated to '${status}'.`,
      returnRequest: returnReq,
    });
  }
);

// ======================================================================
// 4. NURSERY MERCHANT: GET NURSERY SPECIFIC REQUESTS (GET /api/v1/returns/nursery/my-requests)
// ======================================================================
export const getNurseryReturnRequests = catchAsyncErrors(
  async (req: Request, res: Response) => {
    const nurseryId = req.user?._id;

    const requests = await ReturnRequest.find({ nursery: nurseryId })
      .populate("user", "name email phone")
      .populate("order", "orderStatus deliveredAt createdAt shippingInfo")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: requests.length,
      requests,
    });
  }
);

// ======================================================================
// 5. CUSTOMER: GET RETURN REQUESTS FOR AN ORDER (GET /api/v1/returns/order/:orderId)
// ======================================================================
export const getOrderReturnRequests = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawOrderId = req.params.orderId;
    const orderId = String(Array.isArray(rawOrderId) ? rawOrderId[0] : rawOrderId || "");

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return next(new ErrorHandler("Invalid order ID.", 400));
    }

    const requests = await ReturnRequest.find({
      order: orderId,
      user: req.user?._id,
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      requests,
    });
  }
);
