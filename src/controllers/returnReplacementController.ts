import { Request, Response, NextFunction } from "express";
import mongoose, { Types } from "mongoose";
import cloudinary from "cloudinary";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import ReturnReplacementRequest from "../models/ReturnReplacementRequest";
import Order from "../models/orderModel";
import NurseryProfile from "../models/nurseryProfileModel";
import TransactionLedger from "../models/transactionLedgerModel";
import { UploadedFile } from "express-fileupload";
import { cleanupTempFile } from "../utils/uploadHelper";
import { RequestStatus, RequestType } from "../types/returnReplacement.types";
import { sendReturnReplacementStatusEmails } from "../services/emailService";
import { getRazorpayInstance } from "../services/razorpay";
import { withTransaction } from "../utils/transactionHelper";
import {
  calcLineGross,
  calcLineCommission,
  getCommissionRate,
  roundMoney,
  toPaise,
} from "../utils/financialUtils";
import { modelRegistry, resolveProductAndModel } from "../utils/productRegistry";
import { sendNurseryOrderAlertEmail } from "../utils/orderEmailService";

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
      timeline: [
        {
          status: "Pending",
          action: "REQUEST_CREATED",
          actor: req.user?._id,
          actorRole: req.user?.role || "user",
          notes: (description || req.body.notes || req.body.note || reason || "").trim(),
          timestamp: new Date(),
        },
      ],
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
      .populate("replacementOrderId", "orderStatus createdAt shippingInfo totalPrice orderItems")
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
// 3. CENTRAL ADMIN: UPDATE STATUS & PROCESS FINANCIAL/INVENTORY WORKFLOW
// (PATCH/PUT /api/return-replacement/admin/:id/status)
// ======================================================================
export const updateReturnRequestStatusAdmin = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId || "");
    const { status, adminNotes, adminComments, restockItem, itemCondition, condition } = req.body;

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

    const notes = typeof adminNotes === "string" ? adminNotes : adminComments;
    const trimmedNotes = typeof notes === "string" ? notes.trim() : "";

    // ── Idempotency Check ──
    const isAlreadyProcessed = Boolean(
      returnReq.isProcessed ||
      returnReq.refundDetails?.refundStatus === "PROCESSED" ||
      returnReq.replacementOrderId
    );

    // ── Handle Rejection ──
    if (status === "Rejected") {
      if (isAlreadyProcessed) {
        return res.status(400).json({
          success: false,
          message: "Cannot reject a request that has already been financially processed or replaced.",
        });
      }

      returnReq.status = "Rejected";
      if (trimmedNotes) {
        returnReq.adminNotes = trimmedNotes;
      }
      returnReq.resolvedAt = new Date();
      returnReq.timeline.push({
        status: "Rejected",
        action: "CLAIM_REJECTED",
        actor: req.user?._id,
        actorRole: req.user?.role || "admin",
        notes: trimmedNotes,
        timestamp: new Date(),
      });
      await returnReq.save();

      // Sync Order claim status
      try {
        const order = await Order.findById(returnReq.orderId);
        if (order) {
          const item = order.orderItems.find((i: any) => {
            const idStr = i._id?.toString();
            const itemRefStr = i.item?.toString();
            const targetStr = String(returnReq.itemId);
            return idStr === targetStr || itemRefStr === targetStr;
          });
          if (item && item.claim) {
            item.claim.status = "Rejected";
            await order.save();
          }
        }
      } catch (orderSyncErr: any) {
        console.error("[Order Sync Error]:", orderSyncErr?.message);
      }

      sendReturnReplacementStatusEmails(returnReq._id.toString()).catch((emailErr) =>
        console.error("[EMAIL ERROR] 3-way return replacement notification failed:", emailErr?.message || emailErr)
      );

      return res.status(200).json({
        success: true,
        message: "Return request status updated to 'Rejected'.",
        request: returnReq,
        returnRequest: returnReq,
      });
    }

    // ── Handle Reset to Pending ──
    if (status === "Pending") {
      if (isAlreadyProcessed) {
        return res.status(400).json({
          success: false,
          message: "Cannot reset a processed claim back to 'Pending'.",
        });
      }
      returnReq.status = "Pending";
      if (trimmedNotes) {
        returnReq.adminNotes = trimmedNotes;
      }
      returnReq.timeline.push({
        status: "Pending",
        action: "RESET_TO_PENDING",
        actor: req.user?._id,
        actorRole: req.user?.role || "admin",
        notes: trimmedNotes,
        timestamp: new Date(),
      });
      await returnReq.save();

      return res.status(200).json({
        success: true,
        message: "Return request status updated to 'Pending'.",
        request: returnReq,
        returnRequest: returnReq,
      });
    }

    // ── Handle Transition to Approved or Completed ──

    // SCENARIO 1: ALREADY PROCESSED (Idempotency Protection)
    if (isAlreadyProcessed) {
      returnReq.status = status;
      if (trimmedNotes) {
        returnReq.adminNotes = trimmedNotes;
      }
      if (!returnReq.resolvedAt) {
        returnReq.resolvedAt = new Date();
      }
      returnReq.timeline.push({
        status,
        action: "STATUS_UPDATED",
        actor: req.user?._id,
        actorRole: req.user?.role || "admin",
        notes: trimmedNotes,
        timestamp: new Date(),
      });
      await returnReq.save();

      // Sync Order claim status if needed
      try {
        const order = await Order.findById(returnReq.orderId);
        if (order) {
          const item = order.orderItems.find((i: any) => {
            const idStr = i._id?.toString();
            const itemRefStr = i.item?.toString();
            const targetStr = String(returnReq.itemId);
            return idStr === targetStr || itemRefStr === targetStr;
          });
          if (item && item.claim) {
            item.claim.status = "Approved";
            await order.save();
          }
        }
      } catch (orderSyncErr: any) {
        console.error("[Order Sync Error]:", orderSyncErr?.message);
      }

      sendReturnReplacementStatusEmails(returnReq._id.toString()).catch((emailErr) =>
        console.error("[EMAIL ERROR] 3-way notification failed:", emailErr?.message || emailErr)
      );

      return res.status(200).json({
        success: true,
        message: `Return request status updated to '${status}'.`,
        request: returnReq,
        returnRequest: returnReq,
      });
    }

    // SCENARIO 2: FIRST-TIME PROCESSING (ACID TRANSACTION WRAPPED)
    let spawnedReplacementOrderId: Types.ObjectId | undefined;

    await withTransaction(async (session) => {
      // 1. Fetch Order inside transaction session
      const order = await Order.findById(returnReq.orderId).session(session || null);
      if (!order) {
        throw new ErrorHandler("Associated order record not found.", 404);
      }

      // 2. Identify target line item
      const targetItem = order.orderItems.find((item: any) => {
        const idStr = item._id?.toString();
        const itemRefStr = item.item?.toString();
        const targetStr = String(returnReq.itemId);
        return idStr === targetStr || itemRefStr === targetStr;
      });

      if (!targetItem) {
        throw new ErrorHandler("Target item not found in associated order.", 404);
      }

      const isRestockable = Boolean(
        restockItem === true ||
        itemCondition === "restockable" ||
        condition === "restockable"
      );

      if (returnReq.requestType === "Return") {
        // ─────────────────────────────────────────────────────────────
        // 💰 A. RETURN FLOW: REFUND & DOUBLE-ENTRY LEDGER RECONCILIATION
        // ─────────────────────────────────────────────────────────────
        const lineGross = calcLineGross(targetItem.price, targetItem.quantity);
        const taxAmount = Number(targetItem.taxAmount) || 0;
        const itemRefundAmount = roundMoney(lineGross + taxAmount);

        // Calculate previously refunded total to guarantee we never exceed order total
        const previouslyRefunded = (order.orderItems || []).reduce((acc: number, it: any) => {
          if (it.refundDetails?.refundStatus === "PROCESSED") {
            return acc + (Number(it.refundDetails.refundAmount) || 0);
          }
          return acc;
        }, 0) + (order.refundDetails?.refundStatus === "PROCESSED" ? Number(order.refundDetails.refundAmount) || 0 : 0);

        const remainingRefundable = roundMoney(Math.max(0, (order.totalPrice || 0) - previouslyRefunded));
        const actualRefundRupees = roundMoney(Math.min(itemRefundAmount, remainingRefundable));

        const paymentId = order.paymentInfo?.id;
        const isOnlinePayment = Boolean(
          paymentId && typeof paymentId === "string" && paymentId.startsWith("pay_")
        );

        let refundId = `offline_ret_${returnReq._id.toString()}`;
        let refundStatus: "PROCESSED" | "PENDING_MANUAL_REVIEW" = "PROCESSED";

        if (isOnlinePayment && actualRefundRupees > 0) {
          try {
            const razorpay = getRazorpayInstance();
            const refundRes = await razorpay.payments.refund(paymentId, {
              amount: toPaise(actualRefundRupees),
              speed: "normal",
              notes: {
                claimId: returnReq._id.toString(),
                orderId: order._id.toString(),
                itemId: targetItem._id ? targetItem._id.toString() : String(returnReq.itemId),
                reason: "Return Claim Approved",
              },
            });
            refundId = refundRes.id;
          } catch (gatewayErr: any) {
            console.error(
              `🚨 [Razorpay Return Refund Error] Failed for claim #${returnReq._id} (Payment: ${paymentId}):`,
              gatewayErr?.message || gatewayErr
            );
            throw new ErrorHandler(
              `Payment gateway refund failed: ${gatewayErr?.message || "Razorpay API error"}`,
              502
            );
          }
        }

        // 📒 Double-Entry Bookkeeping Ledger
        const ledgerEntries: any[] = [];
        const commissionToReverse = calcLineCommission(lineGross, targetItem.itemModel);
        const commRate = await getCommissionRate(targetItem.itemModel);

        if (targetItem.nursery) {
          // 1. COMMISSION_REVERSED: Credit nursery for marketplace commission
          ledgerEntries.push({
            nursery: targetItem.nursery,
            entryType: "COMMISSION_REVERSED",
            amount: commissionToReverse,
            direction: "CREDIT",
            description: `Commission reversed on return — Claim #${returnReq._id} | Order #${order._id}`,
            orderId: order._id,
            orderItemId: targetItem._id,
            metadata: {
              itemModel: targetItem.itemModel,
              commissionRate: commRate,
              lineGross,
              quantity: targetItem.quantity,
              refundId,
              reason: "RETURN_CLAIM_APPROVED",
              claimId: returnReq._id.toString(),
            },
          });

          // 2. CUSTOMER_REFUND: Debit customer refund
          ledgerEntries.push({
            nursery: targetItem.nursery,
            entryType: "CUSTOMER_REFUND",
            amount: actualRefundRupees,
            direction: "DEBIT",
            description: `Customer refund for Return Claim #${returnReq._id} — Order #${order._id}`,
            orderId: order._id,
            orderItemId: targetItem._id,
            metadata: {
              refundId,
              razorpayPaymentId: paymentId,
              refundAmountRupees: actualRefundRupees,
              reason: "RETURN_APPROVED_REFUND",
              claimId: returnReq._id.toString(),
            },
          });
        }

        if (ledgerEntries.length > 0) {
          const insertOpts = session ? { session } : {};
          await TransactionLedger.insertMany(ledgerEntries, insertOpts);
        }

        // 📦 Inventory Handling (Restock vs Damaged/Defective tracking)
        let inventoryAction: "RESTOCKED" | "DEFECTIVE_RECORDED" = "DEFECTIVE_RECORDED";
        if (isRestockable) {
          const { product: dbProduct, modelName } = await resolveProductAndModel(
            String(targetItem.item),
            targetItem.itemModel
          );
          if (dbProduct && modelName) {
            const updateOpts = session ? { session } : {};
            await modelRegistry[modelName].findByIdAndUpdate(
              dbProduct._id,
              { $inc: { stock: targetItem.quantity } },
              updateOpts
            );
            inventoryAction = "RESTOCKED";
          }
        }

        // Update target order item
        targetItem.refundDetails = {
          refundId,
          refundStatus,
          refundAmount: actualRefundRupees,
          refundedAt: new Date(),
          reason: returnReq.reason || "Return Approved",
        };
        targetItem.status = "Claimed";
        if (targetItem.claim) {
          targetItem.claim.status = "Approved";
        }

        const saveOrderOpts = session ? { session } : {};
        await order.save(saveOrderOpts);

        // Update ReturnReplacement record
        returnReq.refundDetails = {
          refundId,
          refundStatus,
          refundAmount: actualRefundRupees,
          refundedAt: new Date(),
        };
        returnReq.inventoryAction = inventoryAction;
        returnReq.isProcessed = true;

      } else if (returnReq.requestType === "Replacement") {
        // ─────────────────────────────────────────────────────────────
        // 🔄 B. REPLACEMENT FLOW: INVENTORY VALIDATION & REPLACEMENT ORDER
        // ─────────────────────────────────────────────────────────────
        const { product: dbProduct, modelName } = await resolveProductAndModel(
          String(targetItem.item),
          targetItem.itemModel
        );

        if (!dbProduct || !modelName) {
          throw new ErrorHandler(
            "Replacement product catalog reference not found in database.",
            404
          );
        }

        if (dbProduct.stock < targetItem.quantity) {
          throw new ErrorHandler(
            `Insufficient nursery stock to fulfill replacement. Available: ${dbProduct.stock}, Required: ${targetItem.quantity}`,
            400
          );
        }

        const updateOpts = session ? { session } : {};

        // Decrement nursery stock for the new replacement unit
        await modelRegistry[modelName].findByIdAndUpdate(
          dbProduct._id,
          { $inc: { stock: -targetItem.quantity } },
          updateOpts
        );

        // If customer returned unit is marked restockable (e.g. wrong item sent), restore it back
        let inventoryAction: "RESTOCKED" | "DEFECTIVE_RECORDED" | "REPLACEMENT_DISPATCHED" = "REPLACEMENT_DISPATCHED";
        if (isRestockable) {
          await modelRegistry[modelName].findByIdAndUpdate(
            dbProduct._id,
            { $inc: { stock: targetItem.quantity } },
            updateOpts
          );
          inventoryAction = "RESTOCKED";
        }

        // Spawn a free replacement order linked to this nursery & delivery address
        const replacementPaymentId = `free_replacement_${returnReq._id.toString()}`;
        const replacementOrderId = `free_order_${returnReq._id.toString()}`;

        const replacementOrderPayload = {
          shippingInfo: {
            name: order.shippingInfo?.name || "Customer",
            phone: order.shippingInfo?.phone || "",
            address: order.shippingInfo?.address || "",
            city: order.shippingInfo?.city || "",
            state: order.shippingInfo?.state || "",
            country: order.shippingInfo?.country || "India",
            pinCode: order.shippingInfo?.pinCode || "",
          },
          orderItems: [
            {
              itemModel: targetItem.itemModel,
              item: targetItem.item,
              quantity: targetItem.quantity,
              price: 0,
              priceAtPurchase: 0,
              originalPrice: targetItem.originalPrice || targetItem.price,
              discountPrice: 0,
              taxAmount: 0,
              taxRatePercentage: 0,
              taxCategory: targetItem.taxCategory || "General",
              isTaxInclusive: true,
              commissionRatePercentage: 0,
              commissionAmount: 0,
              nurseryEarnings: 0,
              nursery: targetItem.nursery,
              status: "Processing" as const,
              claim: {
                isClaimed: false,
              },
            },
          ],
          user: order.user,
          paymentInfo: {
            id: replacementPaymentId,
            orderId: replacementOrderId,
            status: "Replacement Free of Charge",
          },
          itemsPrice: 0,
          taxPrice: 0,
          shippingPrice: 0,
          totalPrice: 0,
          orderStatus: "Processing" as const,
          paidAt: new Date(),
        };

        const createOrderOpts = session ? { session } : {};
        const createdOrders: any = await Order.create([replacementOrderPayload as any], createOrderOpts);
        const replacementOrder = Array.isArray(createdOrders) ? createdOrders[0] : createdOrders;
        spawnedReplacementOrderId = replacementOrder?._id;

        // Update target item in original order
        targetItem.status = "Claimed";
        if (targetItem.claim) {
          targetItem.claim.status = "Approved";
        }
        await order.save(updateOpts);

        returnReq.replacementOrderId = replacementOrder?._id;
        returnReq.inventoryAction = inventoryAction;
        returnReq.isProcessed = true;
      }

      // Finalize ReturnReplacement document status & timeline
      returnReq.status = status;
      if (trimmedNotes) {
        returnReq.adminNotes = trimmedNotes;
      }
      returnReq.resolvedAt = new Date();

      returnReq.timeline.push({
        status,
        action:
          returnReq.requestType === "Return"
            ? "RETURN_REFUND_PROCESSED"
            : "REPLACEMENT_ORDER_SPAWNED",
        actor: req.user?._id,
        actorRole: req.user?.role || "admin",
        notes: trimmedNotes,
        timestamp: new Date(),
      });

      const saveReturnOpts = session ? { session } : {};
      await returnReq.save(saveReturnOpts);
    });

    // ── Post-transaction Notifications & Alerts ──
    sendReturnReplacementStatusEmails(returnReq._id.toString()).catch((emailErr) =>
      console.error("[EMAIL ERROR] 3-way return replacement notification failed:", emailErr?.message || emailErr)
    );

    if (spawnedReplacementOrderId && returnReq.nurseryId) {
      sendNurseryOrderAlertEmail(
        returnReq.nurseryId.toString(),
        spawnedReplacementOrderId.toString(),
        [
          {
            productName: returnReq.productName,
            name: returnReq.productName,
            quantity: 1,
            price: 0,
          },
        ],
        "Customer Hub"
      ).catch((alertErr) =>
        console.error("[EMAIL ERROR] Nursery replacement order alert failed:", alertErr?.message || alertErr)
      );
    }

    return res.status(200).json({
      success: true,
      message:
        returnReq.requestType === "Return"
          ? `Return request approved and customer refund of ₹${returnReq.refundDetails?.refundAmount || 0} successfully processed.`
          : `Replacement request approved and replacement order #${spawnedReplacementOrderId || returnReq.replacementOrderId} created.`,
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
      .populate("replacementOrderId", "orderStatus createdAt shippingInfo")
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
    })
      .populate("replacementOrderId", "orderStatus createdAt shippingInfo")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      requests,
    });
  }
);
