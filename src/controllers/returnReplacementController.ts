import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import cloudinary from "cloudinary";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import ReturnReplacementRequest from "../models/ReturnReplacementRequest";
import Order from "../models/orderModel";
import NurseryProfile from "../models/nurseryProfileModel";
import { UploadedFile } from "express-fileupload";
import { cleanupTempFile } from "../utils/uploadHelper";
import { RequestStatus, RequestType } from "../types/returnReplacement.types";
import { sendReturnReplacementStatusEmails } from "../services/emailService";

const MAX_RETURN_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 Hours in Milliseconds

// ======================================================================
// 1. CUSTOMER: CREATE RETURN / REPLACEMENT REQUEST (POST /api/return-replacement/create)
// ======================================================================
export const createReturnReplacementRequest = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      orderId,
      itemId,
      requestType,
      reason,
      description,
      productName,
      productImage,
    } = req.body;

    // ── Field Validations ──
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: "Valid order ID is required." });
    }

    if (!itemId) {
      return res.status(400).json({ success: false, message: "Target item reference is required." });
    }

    if (!["Return", "Replacement"].includes(requestType)) {
      return res.status(400).json({ success: false, message: "Request type must be 'Return' or 'Replacement'." });
    }

    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({ success: false, message: "Reason for return or replacement is required." });
    }

    // ── Fetch Order & Ownership Verification ──
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    const currentUserId = req.user?._id?.toString();
    if (order.user?.toString() !== currentUserId) {
      return res.status(403).json({ success: false, message: "You are not authorized to file returns for this order." });
    }

    // ── Delivery Status & 24-Hour Rule Guard ──
    if (order.orderStatus !== "Delivered") {
      return res.status(400).json({
        success: false,
        message: "Return or replacement can only be requested for delivered orders.",
      });
    }

    const deliveredTime = new Date(order.deliveredAt || order.updatedAt).getTime();
    const now = Date.now();
    const hoursPassed = (now - deliveredTime) / (1000 * 60 * 60);

    if (hoursPassed > 24) {
      return res.status(400).json({
        success: false,
        message: "24-hour return/replacement window has expired.",
      });
    }

    // ── Identify Target Order Item ──
    const targetItem = order.orderItems.find((item: any) => {
      const idStr = item._id?.toString();
      const itemRefStr = item.item?.toString();
      const itemIdStr = String(itemId);
      return idStr === itemIdStr || itemRefStr === itemIdStr;
    });

    if (!targetItem) {
      return res.status(404).json({
        success: false,
        message: "Specified item not found in this order.",
      });
    }

    const effectiveItemId = targetItem._id || itemId;

    // ── Check if Duplicate Request Already Exists ──
    const existing = await ReturnReplacementRequest.findOne({
      orderId: order._id,
      itemId: effectiveItemId,
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: `A ${existing.requestType} request has already been registered for this item (Status: ${existing.status}).`,
      });
    }

    // ── Proof Images Handling (Multipart upload, Base64, or direct URLs) ──
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

    // 2. Direct URLs or Base64 in body.proofImages
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

    // 3. Single proofImage field fallback
    if (req.body.proofImage && typeof req.body.proofImage === "string") {
      const single = req.body.proofImage.trim();
      if (single.startsWith("http") && !uploadedProofUrls.includes(single)) {
        uploadedProofUrls.push(single);
      }
    }

    // ── Resolve Nursery & Product Details ──
    const effectiveNurseryId = targetItem.nursery || order.orderItems[0]?.nursery;
    const finalProductName =
      productName ||
      (targetItem as any).name ||
      (targetItem as any).productName ||
      "Botanical Item";
    const finalProductImage =
      productImage ||
      (targetItem as any).coverImage?.url ||
      (targetItem as any).images?.[0]?.url ||
      (uploadedProofUrls.length > 0 ? uploadedProofUrls[0] : "");

    // ── Create ReturnReplacementRequest Record ──
    const returnReq = await ReturnReplacementRequest.create({
      orderId: order._id,
      userId: req.user?._id,
      nurseryId: effectiveNurseryId,
      itemId: effectiveItemId,
      productName: finalProductName,
      productImage: finalProductImage,
      requestType,
      reason,
      description: (description || req.body.notes || req.body.note || "").trim(),
      proofImages: uploadedProofUrls,
      status: "Pending",
    });

    // ── Update Order Line-Item Claim ──
    targetItem.claim = {
      isClaimed: true,
      claimType: requestType === "Return" ? "Refund" : "Replacement",
      reason,
      proofUrl: uploadedProofUrls[0] || "",
      status: "Pending",
      claimedAt: new Date(),
    };
    await order.save();

    return res.status(201).json({
      success: true,
      message: `${requestType} request submitted successfully. Our team will review it within 24 hours.`,
      request: returnReq,
      returnRequest: returnReq,
    });
  }
);

// ======================================================================
// 2. CENTRAL ADMIN: GET ALL RETURN REQUESTS (GET /api/return-replacement/admin/all)
// ======================================================================
export const getAllReturnRequestsAdmin = catchAsyncErrors(
  async (req: Request, res: Response) => {
    const { status, requestType, type } = req.query;

    const filter: Record<string, any> = {};
    if (status && typeof status === "string" && status !== "all" && status !== "All") {
      filter.status = status;
    }

    const selectedType = requestType || type;
    if (selectedType && typeof selectedType === "string" && selectedType !== "all" && selectedType !== "All") {
      filter.requestType = selectedType;
    }

    const requests = await ReturnReplacementRequest.find(filter)
      .populate("userId", "name email phone avatar")
      .populate("nurseryId", "name email")
      .populate("orderId", "orderStatus deliveredAt createdAt shippingInfo totalPrice orderItems")
      .sort({ createdAt: -1 });

    // Enrich nursery data with NurseryProfile businessName if available
    const nurseryUserIds = requests
      .map((r: any) => r.nurseryId?._id || r.nurseryId)
      .filter(Boolean);

    const profiles = await NurseryProfile.find({
      nursery: { $in: nurseryUserIds },
    }).select("nursery businessName businessPhone");

    const profileMap = new Map<string, any>(
      profiles.map((p: any) => [p.nursery.toString(), p])
    );

    const enrichedRequests = requests.map((r: any) => {
      const doc = r.toObject ? r.toObject() : { ...r };
      const nid = doc.nurseryId?._id?.toString() || doc.nurseryId?.toString();
      if (nid && profileMap.has(nid)) {
        const prof = profileMap.get(nid);
        if (typeof doc.nurseryId === "object" && doc.nurseryId) {
          doc.nurseryId.businessName = prof.businessName || doc.nurseryId.name;
          doc.nurseryId.phone = prof.businessPhone;
        }
      }
      return doc;
    });

    res.status(200).json({
      success: true,
      count: enrichedRequests.length,
      requests: enrichedRequests,
    });
  }
);

// ======================================================================
// 3. CENTRAL ADMIN: UPDATE STATUS & NOTES (PATCH /api/return-replacement/admin/:id/status)
// ======================================================================
export const updateReturnRequestStatusAdmin = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId || "");
    const { status, adminNotes, adminComments } = req.body;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Return Request ID." });
    }

    const validStatuses: RequestStatus[] = ["Pending", "Approved", "Rejected", "Completed"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${validStatuses.join(", ")}`,
      });
    }

    const returnReq = await ReturnReplacementRequest.findById(id);
    if (!returnReq) {
      return res.status(404).json({ success: false, message: "Return replacement request record not found." });
    }

    returnReq.status = status;
    const notes = typeof adminNotes === "string" ? adminNotes : adminComments;
    if (typeof notes === "string") {
      returnReq.adminNotes = notes.trim();
    }
    if (["Approved", "Rejected", "Completed"].includes(status)) {
      returnReq.resolvedAt = new Date();
    }
    await returnReq.save();

    // Sync status back to corresponding Order document
    try {
      const order = await Order.findById(returnReq.orderId);
      if (order) {
        const item = order.orderItems.find(
          (i: any) =>
            i._id?.toString() === returnReq.itemId?.toString() ||
            i.item?.toString() === returnReq.itemId?.toString()
        );
        if (item && item.claim) {
          item.claim.status = status === "Completed" ? "Approved" : status;
          await order.save();
        }
      }
    } catch (orderSyncErr: any) {
      console.error("[Order Sync Error]:", orderSyncErr?.message);
    }

    // 📧 Fire-and-forget: Automated 3-way transactional Email notification system (Customer, Nursery, Admin Audit)
    sendReturnReplacementStatusEmails(returnReq._id.toString()).catch((emailErr) =>
      console.error("[EMAIL ERROR] 3-way return replacement notification failed:", emailErr?.message || emailErr)
    );

    return res.status(200).json({
      success: true,
      message: `Return request status updated to '${status}'.`,
      request: returnReq,
      returnRequest: returnReq,
    });
  }
);

// ======================================================================
// 4. NURSERY MERCHANT: GET NURSERY SPECIFIC REQUESTS (GET /api/return-replacement/nursery/my-requests)
// ======================================================================
export const getNurseryReturnRequests = catchAsyncErrors(
  async (req: Request, res: Response) => {
    const nurseryId = (req.user as any)?.nurseryId || req.user?._id;

    const requests = await ReturnReplacementRequest.find({ nurseryId })
      .populate("userId", "name email phone")
      .populate("orderId", "orderStatus deliveredAt createdAt shippingInfo")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: requests.length,
      requests,
    });
  }
);

// ======================================================================
// 5. CUSTOMER: GET RETURN REQUESTS FOR AN ORDER (GET /api/return-replacement/order/:orderId)
// ======================================================================
export const getOrderReturnRequests = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawOrderId = req.params.orderId;
    const orderId = String(Array.isArray(rawOrderId) ? rawOrderId[0] : rawOrderId || "");

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order ID." });
    }

    const requests = await ReturnReplacementRequest.find({
      orderId,
      userId: req.user?._id,
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      requests,
    });
  }
);
