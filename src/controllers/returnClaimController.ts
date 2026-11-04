import { Request, Response, NextFunction } from "express";
import mongoose, { Types } from "mongoose";
import cloudinary from "cloudinary";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import ClaimRequest from "../models/ClaimRequest";
import Order from "../models/orderModel";
import NurseryProfile from "../models/nurseryProfileModel";
import TransactionLedger from "../models/transactionLedgerModel";
import { UploadedFile } from "express-fileupload";
import { cleanupTempFile } from "../utils/uploadHelper";
import { ClaimStatus, ClaimType } from "../types/claim.types";
import { sendReturnReplacementStatusEmails } from "../services/emailService";
import { getRazorpayInstance } from "../services/razorpay";
import { withTransaction } from "../utils/transactionHelper";
import {
  calcLineGross,
  roundMoney,
  toPaise,
} from "../utils/financialUtils";
import Product from "../models/productModel";
import { modelRegistry, resolveProductAndModel, getCaseInsensitiveModel } from "../utils/productRegistry";
import {
  sendClaimAlertToAdmin,
  sendClaimAlertToNursery,
} from "../utils/orderEmailService";

const MAX_CLAIM_WINDOW_HOURS = 48; // 48-hour return / replacement policy window

/**
 * Normalizes user-submitted or legacy type string to standard ClaimType
 */
const normalizeClaimType = (raw: string | undefined): ClaimType => {
  if (!raw) return "RETURN";
  const clean = String(raw).toUpperCase().replace(/[\s-]/g, "_");
  if (clean === "REPLACEMENT") return "REPLACEMENT";
  if (clean === "DAMAGE_CLAIM" || clean === "CLAIM" || clean === "DAMAGE") return "DAMAGE_CLAIM";
  if (clean === "REFUND") return "RETURN";
  return "RETURN";
};

/**
 * Normalizes status string to standard ClaimStatus
 */
const normalizeClaimStatus = (raw: string | undefined): ClaimStatus => {
  if (!raw) return "PENDING";
  const clean = String(raw).toUpperCase();
  if (clean === "APPROVED") return "APPROVED";
  if (clean === "REJECTED") return "REJECTED";
  if (clean === "COMPLETED") return "COMPLETED";
  return "PENDING";
};

// ======================================================================
// 1. CUSTOMER: CREATE CLAIM / RETURN / REPLACEMENT REQUEST
// ======================================================================
export const createClaimRequest = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      orderId,
      itemId,
      orderItemId,
      productId,
      type,
      requestType,
      claimType,
      reason,
      description,
      productName,
      productImage,
      productModel,
    } = req.body;

    const targetOrderId = orderId || req.body.order;
    if (!targetOrderId || !mongoose.Types.ObjectId.isValid(targetOrderId)) {
      return next(new ErrorHandler("Valid order reference ID is required.", 400));
    }

    const targetItemId = itemId || orderItemId || productId || req.body.item;
    if (!targetItemId) {
      return next(new ErrorHandler("Target item reference identifier is required.", 400));
    }

    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return next(new ErrorHandler("Reason for claim or return is required.", 400));
    }

    const normalizedType = normalizeClaimType(type || requestType || claimType);

    // ── Fetch Order & Ownership Verification ──
    const order = await Order.findById(targetOrderId);
    if (!order) {
      return next(new ErrorHandler("Order record not found.", 404));
    }

    const currentUserId = req.user?._id?.toString();
    if (order.user?.toString() !== currentUserId) {
      return next(new ErrorHandler("You are not authorized to file claims for this order.", 403));
    }

    // ── Delivery Status & 48-Hour Policy Window Guard ──
    if (order.orderStatus !== "Delivered") {
      return next(
        new ErrorHandler(
          "Claims, returns, or replacements can only be filed for successfully delivered orders.",
          400
        )
      );
    }

    const deliveredTime = new Date(order.deliveredAt || order.updatedAt).getTime();
    const hoursPassed = (Date.now() - deliveredTime) / (1000 * 60 * 60);
    if (hoursPassed > MAX_CLAIM_WINDOW_HOURS) {
      return next(
        new ErrorHandler(
          `Policy expired. Claims and returns must be submitted within ${MAX_CLAIM_WINDOW_HOURS} hours of delivery.`,
          400
        )
      );
    }

    // ── Identify Target Order Item ──
    const targetItem = order.orderItems.find((item: any) => {
      const idStr = item._id?.toString();
      const itemRefStr = item.item?.toString();
      const targetStr = String(targetItemId);
      return idStr === targetStr || itemRefStr === targetStr;
    });

    if (!targetItem) {
      return next(new ErrorHandler("Specified item not found in this order sequence.", 404));
    }

    const effectiveItemId = targetItem._id || targetItemId;

    // ── Deduplication Guard ──
    const existingClaim = await ClaimRequest.findOne({
      orderId: order._id,
      itemId: effectiveItemId,
    });

    if (existingClaim) {
      return res.status(400).json({
        success: false,
        message: `A ${existingClaim.type} request has already been registered for this item (Status: ${existingClaim.status}).`,
        claim: existingClaim,
      });
    }

    // ── Upload & Media Proof Handling (Images + Unboxing Video) ──
    const uploadedImages: string[] = [];
    let unboxingVideoUrl = "";

    if (req.files && Object.keys(req.files).length > 0) {
      const fileList: UploadedFile[] = [];
      Object.values(req.files).forEach((f) => {
        if (Array.isArray(f)) {
          fileList.push(...f);
        } else if (f) {
          fileList.push(f);
        }
      });

      for (const file of fileList) {
        try {
          const isVideo =
            file.mimetype.startsWith("video/") ||
            /\.(mp4|webm|mov|mkv|avi)$/i.test(file.name);

          if (isVideo) {
            const uploadedVideo = await cloudinary.v2.uploader.upload(file.tempFilePath, {
              folder: "urban_nursery_claims_videos",
              resource_type: "video",
            });
            if (uploadedVideo.secure_url) {
              unboxingVideoUrl = uploadedVideo.secure_url;
            }
          } else {
            const uploadedImage = await cloudinary.v2.uploader.upload(file.tempFilePath, {
              folder: "urban_nursery_claims_images",
              resource_type: "image",
            });
            if (uploadedImage.secure_url) {
              uploadedImages.push(uploadedImage.secure_url);
            }
          }
        } catch (uploadErr: any) {
          console.error("🚨 [Claim Media Upload Error]:", uploadErr?.message || uploadErr);
        } finally {
          cleanupTempFile(file.tempFilePath);
        }
      }
    }

    // Process direct URLs or Base64 in body (proofImages, images, unboxingVideoUrl, proofUrl)
    const rawImages = req.body.images || req.body.proofImages;
    if (rawImages) {
      let parsedImages = rawImages;
      if (typeof parsedImages === "string") {
        try {
          parsedImages = JSON.parse(parsedImages);
        } catch {
          parsedImages = [parsedImages];
        }
      }
      if (Array.isArray(parsedImages)) {
        for (const img of parsedImages) {
          if (typeof img === "string" && img.startsWith("http")) {
            uploadedImages.push(img);
          }
        }
      }
    }

    const rawVideo = req.body.unboxingVideoUrl || req.body.proofUrl;
    if (rawVideo && typeof rawVideo === "string" && rawVideo.startsWith("http")) {
      if (/\.(mp4|webm|mov|mkv|avi)$/i.test(rawVideo)) {
        unboxingVideoUrl = unboxingVideoUrl || rawVideo;
      } else if (!uploadedImages.includes(rawVideo)) {
        uploadedImages.push(rawVideo);
      }
    }

    // Require at least one proof asset (image or video)
    if (uploadedImages.length === 0 && !unboxingVideoUrl) {
      return next(
        new ErrorHandler(
          "Unboxing or damage proof (photograph or unboxing video) is required to file a claim.",
          400
        )
      );
    }

    // ── Catalog & Vendor Identity Resolution ──
    const resolvedName = productName || (targetItem as any).name || "Botanical Item";
    const resolvedImage = productImage || (targetItem as any).image || (uploadedImages[0] || "");
    const resolvedModel = productModel || targetItem.itemModel || "Plant";
    const nurseryId = targetItem.nursery;

    const legacyRequestTypeString =
      normalizedType === "REPLACEMENT"
        ? "Replacement"
        : normalizedType === "DAMAGE_CLAIM"
        ? "Damage Claim"
        : "Return";

    // ── Create Unified Claim Request ──
    const newClaim = await ClaimRequest.create({
      orderId: order._id,
      itemId: effectiveItemId,
      userId: req.user!._id,
      nurseryId,
      type: normalizedType,
      requestType: legacyRequestTypeString,
      reason: reason.trim(),
      description: (description || "").trim(),
      images: uploadedImages,
      proofImages: uploadedImages,
      unboxingVideoUrl,
      status: "PENDING",
      productName: resolvedName,
      productImage: resolvedImage,
      productModel: resolvedModel,
      refundStatus: "NONE",
      timeline: [
        {
          status: "PENDING",
          action: "CLAIM_SUBMITTED",
          actor: req.user!._id,
          actorRole: "customer",
          notes: `Customer filed a ${normalizedType} request. Reason: "${reason.trim()}"`,
          timestamp: new Date(),
        },
      ],
    });

    // ── Synchronize Order Document Claim State ──
    try {
      targetItem.claim = {
        isClaimed: true,
        claimType: normalizedType === "REPLACEMENT" ? "Replacement" : "Refund",
        reason: reason.trim(),
        proofUrl: unboxingVideoUrl || uploadedImages[0] || "",
        status: "Pending",
        claimedAt: new Date(),
      };
      targetItem.status = "Claimed";
      await order.save();
    } catch (orderSyncErr: any) {
      console.error("Order claim sync error:", orderSyncErr?.message);
    }

    const itemPayload = {
      ...(typeof (targetItem as any).toObject === "function"
        ? (targetItem as any).toObject()
        : targetItem),
      claim: targetItem.claim,
    };

    // ── Non-Blocking Notification Pipeline ──
    sendReturnReplacementStatusEmails(newClaim._id.toString()).catch((emailErr) =>
      console.error("❌ [Email Error] Customer claim receipt failed:", emailErr?.message || emailErr)
    );

    sendClaimAlertToAdmin(
      order._id.toString(),
      itemPayload,
      reason.trim()
    ).catch((err) =>
      console.error("❌ [Email Error] Admin claim notification failed:", err?.message || err)
    );

    if (nurseryId) {
      sendClaimAlertToNursery(
        nurseryId.toString(),
        order._id.toString(),
        itemPayload
      ).catch((err) =>
        console.error("❌ [Email Error] Nursery claim notification failed:", err?.message || err)
      );
    }

    return res.status(201).json({
      success: true,
      message: "Claim request submitted successfully. It will be reviewed by admin within 24 hours.",
      claim: newClaim,
      request: newClaim,
      claimStatus: "Pending",
    });
  }
);

// ======================================================================
// 2. CUSTOMER: GET CLAIMS BY USER / ORDER
// ======================================================================
export const getClaimsByUser = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?._id;
    const rawOrderId = req.params.orderId;
    const orderId = String(Array.isArray(rawOrderId) ? rawOrderId[0] : rawOrderId || "").trim();

    const query: any = {};
    if (req.user?.role !== "admin") {
      query.userId = userId;
    }

    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      query.orderId = orderId;
    }

    const claims = await ClaimRequest.find(query)
      .populate("orderId", "orderStatus deliveredAt createdAt shippingInfo totalPrice")
      .populate("nurseryId", "name email")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: claims.length,
      claims,
      requests: claims, // Backward compatibility alias
    });
  }
);

// ======================================================================
// 3. NURSERY: GET CLAIMS BY NURSERY MERCHANT
// ======================================================================
export const getClaimsByNursery = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const nurseryId = req.user?._id;

    const claims = await ClaimRequest.find({ nurseryId })
      .populate("userId", "name email phone")
      .populate("orderId", "orderStatus deliveredAt createdAt shippingInfo totalPrice")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: claims.length,
      claims,
      requests: claims, // Backward compatibility alias
    });
  }
);

// ======================================================================
// 4. ADMIN: GET ALL CLAIMS (SEARCH, FILTER & PAGINATION)
// ======================================================================
export const getAllClaimsAdmin = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { status, type, requestType, orderId, nurseryId, page = 1, limit = 50 } = req.query;

    const query: any = {};

    if (status) {
      const normStatus = normalizeClaimStatus(String(status));
      // Match both normalized uppercase and legacy capitalized versions
      query.status = { $in: [normStatus, String(status)] };
    }

    const targetType = type || requestType;
    if (targetType && targetType !== "All") {
      const normType = normalizeClaimType(String(targetType));
      query.type = { $in: [normType, String(targetType)] };
    }

    if (orderId && mongoose.Types.ObjectId.isValid(String(orderId))) {
      query.orderId = orderId;
    }

    if (nurseryId && mongoose.Types.ObjectId.isValid(String(nurseryId))) {
      query.nurseryId = nurseryId;
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 50);
    const skip = (pageNum - 1) * limitNum;

    const total = await ClaimRequest.countDocuments(query);
    const claims = await ClaimRequest.find(query)
      .populate("userId", "name email phone")
      .populate("nurseryId", "name email")
      .populate("orderId", "orderStatus deliveredAt createdAt shippingInfo totalPrice paymentInfo")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    return res.status(200).json({
      success: true,
      count: claims.length,
      total,
      claims,
      requests: claims, // Backward compatibility alias
    });
  }
);

// ======================================================================
// 5. GET SINGLE CLAIM BY ID
// ======================================================================
export const getClaimById = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId || "").trim();

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return next(new ErrorHandler("Invalid Claim ID.", 400));
    }

    const claim = await ClaimRequest.findById(id)
      .populate("userId", "name email phone")
      .populate("nurseryId", "name email")
      .populate("orderId", "orderStatus deliveredAt createdAt shippingInfo totalPrice paymentInfo");

    if (!claim) {
      return next(new ErrorHandler("Claim request not found.", 404));
    }

    // Access control: Admin, Nursery owner, or Customer
    const currentUserId = req.user?._id?.toString();
    const isAdmin = req.user?.role === "admin";
    const isOwner = claim.userId?._id?.toString() === currentUserId;
    const isVendor = claim.nurseryId?._id?.toString() === currentUserId;

    if (!isAdmin && !isOwner && !isVendor) {
      return next(new ErrorHandler("Unauthorized access to this claim record.", 403));
    }

    return res.status(200).json({
      success: true,
      claim,
      request: claim,
    });
  }
);

// ======================================================================
// 6. ADMIN: UPDATE CLAIM STATUS (LIFECYCLE TRANSITIONS, REFUNDS & REPLACEMENTS)
// ======================================================================
export const updateClaimStatus = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId || "").trim();
    const {
      status,
      adminNotes,
      adminComments,
      restockItem,
      itemCondition,
      condition,
      trackingCarrier,
      trackingNumber,
      trackingUrl,
    } = req.body;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return next(new ErrorHandler("Invalid Claim ID.", 400));
    }

    const normStatus = normalizeClaimStatus(status);
    const validStatuses: ClaimStatus[] = ["PENDING", "APPROVED", "REJECTED", "COMPLETED"];
    if (!validStatuses.includes(normStatus)) {
      return next(
        new ErrorHandler(
          `Invalid status. Allowed values: ${validStatuses.join(", ")}`,
          400
        )
      );
    }

    const claim = await ClaimRequest.findById(id);
    if (!claim) {
      return next(new ErrorHandler("Claim record not found.", 404));
    }

    const notes = typeof adminNotes === "string" ? adminNotes : adminComments;
    const trimmedNotes = typeof notes === "string" ? notes.trim() : "";

    // ── Idempotency Check ──
    const isAlreadyProcessed = Boolean(
      claim.isProcessed ||
      claim.refundStatus === "PROCESSED" ||
      claim.refundDetails?.refundStatus === "PROCESSED" ||
      claim.replacementOrderId
    );

    // ── Handle Rejection ──
    if (normStatus === "REJECTED") {
      if (isAlreadyProcessed) {
        return res.status(400).json({
          success: false,
          message: "Cannot reject a claim that has already been financially processed or replaced.",
        });
      }

      claim.status = "REJECTED";
      if (trimmedNotes) {
        claim.adminNotes = trimmedNotes;
        claim.adminComments = trimmedNotes;
      }
      claim.resolvedAt = new Date();
      claim.timeline.push({
        status: "REJECTED",
        action: "CLAIM_REJECTED",
        actor: req.user?._id,
        actorRole: req.user?.role || "admin",
        notes: trimmedNotes || "Claim rejected by administrator.",
        timestamp: new Date(),
      });
      await claim.save();

      // Sync Order document item claim status
      try {
        const order = await Order.findById(claim.orderId);
        if (order) {
          const item = order.orderItems.find((i: any) => {
            const idStr = i._id?.toString();
            const itemRefStr = i.item?.toString();
            const targetStr = String(claim.itemId);
            return idStr === targetStr || itemRefStr === targetStr;
          });
          if (item && item.claim) {
            item.claim.status = "Rejected";
            await order.save();
          }
        }
      } catch (orderSyncErr: any) {
        console.error("[Order Sync Error on Rejection]:", orderSyncErr?.message);
      }

      sendReturnReplacementStatusEmails(claim._id.toString()).catch((emailErr) =>
        console.error("❌ [Email Error] Claim rejection alert failed:", emailErr?.message || emailErr)
      );

      return res.status(200).json({
        success: true,
        message: "Claim status updated to 'REJECTED'.",
        claim,
        request: claim,
      });
    }

    // ── Handle Reset to PENDING ──
    if (normStatus === "PENDING") {
      if (isAlreadyProcessed) {
        return res.status(400).json({
          success: false,
          message: "Cannot reset an already processed claim back to 'PENDING'.",
        });
      }
      claim.status = "PENDING";
      if (trimmedNotes) {
        claim.adminNotes = trimmedNotes;
        claim.adminComments = trimmedNotes;
      }
      claim.timeline.push({
        status: "PENDING",
        action: "RESET_TO_PENDING",
        actor: req.user?._id,
        actorRole: req.user?.role || "admin",
        notes: trimmedNotes || "Claim reset to PENDING for re-examination.",
        timestamp: new Date(),
      });
      await claim.save();

      return res.status(200).json({
        success: true,
        message: "Claim status updated to 'PENDING'.",
        claim,
        request: claim,
      });
    }

    // ── Handle APPROVED or COMPLETED ──

    // SCENARIO 1: ALREADY PROCESSED (Idempotency Safe Update)
    if (isAlreadyProcessed) {
      claim.status = normStatus;
      if (trimmedNotes) {
        claim.adminNotes = trimmedNotes;
        claim.adminComments = trimmedNotes;
      }
      if (!claim.resolvedAt) {
        claim.resolvedAt = new Date();
      }

      if (trackingCarrier || trackingNumber || trackingUrl) {
        claim.trackingInfo = {
          carrier: trackingCarrier || claim.trackingInfo?.carrier || "",
          trackingNumber: trackingNumber || claim.trackingInfo?.trackingNumber || "",
          trackingUrl: trackingUrl || claim.trackingInfo?.trackingUrl || "",
          dispatchedAt: claim.trackingInfo?.dispatchedAt || new Date(),
          deliveredAt: normStatus === "COMPLETED" ? new Date() : claim.trackingInfo?.deliveredAt,
        };
      }

      claim.timeline.push({
        status: normStatus,
        action: "STATUS_UPDATED",
        actor: req.user?._id,
        actorRole: req.user?.role || "admin",
        notes: trimmedNotes || `Status updated to ${normStatus}.`,
        timestamp: new Date(),
      });
      await claim.save();

      sendReturnReplacementStatusEmails(claim._id.toString()).catch((emailErr) =>
        console.error("❌ [Email Error] Claim update notification failed:", emailErr?.message || emailErr)
      );

      return res.status(200).json({
        success: true,
        message: `Claim status updated to '${normStatus}'.`,
        claim,
        request: claim,
      });
    }

    // SCENARIO 2: FIRST-TIME PROCESSING (ACID TRANSACTION WRAPPED)
    await withTransaction(async (session) => {
      const order = await Order.findById(claim.orderId).session(session || null);
      if (!order) {
        throw new ErrorHandler("Associated order record not found.", 404);
      }

      const targetItem = order.orderItems.find((item: any) => {
        const idStr = item._id?.toString();
        const itemRefStr = item.item?.toString();
        const targetStr = String(claim.itemId);
        return idStr === targetStr || itemRefStr === targetStr;
      });

      if (!targetItem) {
        throw new ErrorHandler("Target item not found in associated order sequence.", 404);
      }

      const isRestockable = Boolean(
        restockItem === true ||
        itemCondition === "restockable" ||
        condition === "restockable"
      );

      const isReturnOrDamageRefund =
        claim.type === "RETURN" || claim.type === "DAMAGE_CLAIM" || (claim as any).type === "Return";

      if (isReturnOrDamageRefund) {
        // ─────────────────────────────────────────────────────────────
        // 💰 A. RETURN & DAMAGE CLAIM: RAZORPAY REFUND & LEDGER REVERSAL
        // ─────────────────────────────────────────────────────────────
        const lineGross = calcLineGross(targetItem.price, targetItem.quantity);
        const taxAmount = Number(targetItem.taxAmount) || 0;
        const itemRefundAmount = roundMoney(lineGross + taxAmount);

        // Cap refund so we never exceed total order amount
        const previouslyRefunded =
          (order.orderItems || []).reduce((acc: number, it: any) => {
            if (it.refundDetails?.refundStatus === "PROCESSED") {
              return acc + (Number(it.refundDetails.refundAmount) || 0);
            }
            return acc;
          }, 0) +
          (order.refundDetails?.refundStatus === "PROCESSED"
            ? Number(order.refundDetails.refundAmount) || 0
            : 0);

        const remainingRefundable = roundMoney(
          Math.max(0, (order.totalPrice || 0) - previouslyRefunded)
        );
        const actualRefundRupees = roundMoney(Math.min(itemRefundAmount, remainingRefundable));

        const paymentId = order.paymentInfo?.id;
        const isOnlinePayment = Boolean(
          paymentId && typeof paymentId === "string" && paymentId.startsWith("pay_")
        );

        let refundId = `offline_ret_${claim._id.toString()}`;
        let refundStatus: "PROCESSED" | "PENDING_MANUAL_REVIEW" = "PROCESSED";

        if (isOnlinePayment && actualRefundRupees > 0) {
          try {
            const razorpay = getRazorpayInstance();
            const refundRes = await razorpay.payments.refund(paymentId, {
              amount: toPaise(actualRefundRupees),
              speed: "normal",
              notes: {
                claimId: claim._id.toString(),
                orderId: order._id.toString(),
                itemId: targetItem._id ? targetItem._id.toString() : String(claim.itemId),
                reason: `${claim.type} Approved`,
              },
            });
            refundId = refundRes.id;
          } catch (gatewayErr: any) {
            console.error(
              `🚨 [Razorpay Return Refund Error] Failed for claim #${claim._id} (Payment: ${paymentId}):`,
              gatewayErr?.message || gatewayErr
            );
            throw new ErrorHandler(
              `Payment gateway refund failed: ${gatewayErr?.message || "Razorpay API error"}`,
              502
            );
          }
        }

        claim.refundStatus = "PROCESSED";
        claim.refundDetails = {
          refundId,
          refundStatus,
          refundAmount: actualRefundRupees,
          refundedAt: new Date(),
        };

        // Double-entry ledger adjustment for vendor balance
        if (targetItem.nursery) {
          const originalCommission =
            Number(targetItem.commissionAudit?.originalCommission) ||
            Number(targetItem.commissionAmount) ||
            0;

          if (originalCommission > 0) {
            await TransactionLedger.create(
              [
                {
                  nursery: targetItem.nursery,
                  entryType: "COMMISSION_REVERSED",
                  amount: originalCommission,
                  direction: "CREDIT",
                  description: `Commission reversed for ${claim.type} on item #${claim.itemId} (Order #${order._id})`,
                  orderId: order._id,
                  orderItemId: targetItem._id,
                  metadata: {
                    claimId: claim._id,
                    refundId,
                    refundAmount: actualRefundRupees,
                    requestType: claim.type,
                  },
                },
              ],
              session ? { session } : {}
            );
          }
        }

        // Restock inventory if item is in restockable condition
        if (isRestockable) {
          await Product.findByIdAndUpdate(
            targetItem.item,
            { $inc: { stock: targetItem.quantity } },
            session ? { session } : {}
          );
          claim.inventoryAction = "RESTOCKED";
        } else {
          claim.inventoryAction = "DEFECTIVE_RECORDED";
        }
      } else {
        // ─────────────────────────────────────────────────────────────
        // 📦 B. REPLACEMENT FLOW: SPAWN REPLACEMENT ORDER & DEDUCT STOCK
        // ─────────────────────────────────────────────────────────────
        const [replacementOrder] = await Order.create(
          [
            {
              shippingInfo: order.shippingInfo,
              orderItems: [
                {
                  itemModel: targetItem.itemModel,
                  item: targetItem.item,
                  quantity: targetItem.quantity,
                  price: 0,
                  priceAtPurchase: 0,
                  taxAmount: 0,
                  taxRatePercentage: 0,
                  commissionRatePercentage: 0,
                  commissionAmount: 0,
                  nurseryEarnings: 0,
                  nursery: targetItem.nursery,
                  status: "Processing",
                },
              ],
              user: order.user,
              paymentInfo: {
                id: `replacement_${claim._id.toString()}`,
                orderId: `replacement_order_${claim._id.toString()}`,
                status: "captured",
              },
              itemsPrice: 0,
              taxPrice: 0,
              shippingPrice: 0,
              totalPrice: 0,
              paidAt: new Date(),
              orderStatus: "Processing",
            },
          ],
          session ? { session } : {}
        );

        claim.replacementOrderId = replacementOrder._id;
        claim.inventoryAction = "REPLACEMENT_DISPATCHED";

        // Deduct replacement stock from catalog
        await Product.findByIdAndUpdate(
          targetItem.item,
          { $inc: { stock: -targetItem.quantity } },
          session ? { session } : {}
        );
      }

      // Update Claim metadata & Timeline
      claim.status = normStatus;
      claim.isProcessed = true;
      claim.resolvedAt = new Date();
      if (trimmedNotes) {
        claim.adminNotes = trimmedNotes;
        claim.adminComments = trimmedNotes;
      }

      if (trackingCarrier || trackingNumber || trackingUrl) {
        claim.trackingInfo = {
          carrier: trackingCarrier || "",
          trackingNumber: trackingNumber || "",
          trackingUrl: trackingUrl || "",
          dispatchedAt: new Date(),
        };
      }

      claim.timeline.push({
        status: normStatus,
        action: isReturnOrDamageRefund ? "CLAIM_APPROVED_REFUNDED" : "CLAIM_APPROVED_REPLACED",
        actor: req.user?._id,
        actorRole: req.user?.role || "admin",
        notes: trimmedNotes || `Claim approved and processed by administrator.`,
        timestamp: new Date(),
      });

      await claim.save({ session: session || undefined });

      // Synchronize Order line item claim status
      if (targetItem.claim) {
        targetItem.claim.status = "Approved";
      }
      await order.save({ session: session || undefined });
    });

    // ── Non-Blocking 3-Way Notification Dispatch ──
    sendReturnReplacementStatusEmails(claim._id.toString()).catch((emailErr) =>
      console.error("❌ [Email Error] 3-way notification failed:", emailErr?.message || emailErr)
    );

    return res.status(200).json({
      success: true,
      message: `Claim request successfully processed and marked as '${normStatus}'.`,
      claim,
      request: claim,
    });
  }
);
