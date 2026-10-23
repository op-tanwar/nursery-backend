import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import Payout from "../models/payoutModel";
import NurseryProfile from "../models/nurseryProfileModel";
import TransactionLedger from "../models/transactionLedgerModel";
import {
  calculateNurseryFinancialSummary,
  calculateGlobalFinancialSummary,
  getNextSettlementDate,
  roundMoney,
} from "../utils/financialUtils";
import { withTransaction } from "../utils/transactionHelper";
import { sendPayoutStatusEmail } from "../templates/emails";


// ======================================================================
// 🏡 NURSERY PAYOUT ENDPOINTS
// ======================================================================

/**
 * 1. GET /api/v1/payouts/nursery/summary
 * Returns comprehensive, real-time financial stats for the logged-in nursery.
 */
export const getNurseryPayoutSummary = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(new ErrorHandler("Please login to access this resource", 401));
    }
    const nurseryId = req.user._id;

    // Single source of truth calculation
    const summary = await calculateNurseryFinancialSummary(nurseryId);

    // Fetch nursery profile bank details
    const profile = await NurseryProfile.findOne({ nursery: nurseryId })
      .select("+bankDetails.accountNumber +bankDetails.ifscCode")
      .lean();

    const settlement = getNextSettlementDate();

    res.status(200).json({
      success: true,
      summary: {
        ...summary,
        bankDetails: profile?.bankDetails || null,
        nurseryName: profile?.businessName || req.user.name,
        nextSettlementDate: settlement.iso,
        nextSettlementLabel: settlement.label,
        status: summary.hasNegativeBalance
          ? "NegativeBalance"
          : summary.pendingPayouts > 0
          ? "Processing"
          : "Available",
      },
    });
  }
);


/**
 * 2. GET /api/v1/payouts/nursery/history
 * Returns paginated payout requests for the logged-in nursery.
 */
export const getNurseryPayoutHistory = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(new ErrorHandler("Please login to access this resource", 401));
    }
    const nurseryId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    const query: Record<string, any> = { nursery: nurseryId };
    if (status && status !== "ALL") {
      query.status = status;
    }

    const currentPage = Math.max(1, Number(page));
    const resPerPage = Math.max(1, Number(limit));
    const skip = (currentPage - 1) * resPerPage;

    const [totalCount, payouts] = await Promise.all([
      Payout.countDocuments(query),
      Payout.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(resPerPage)
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      payouts,
      totalCount,
      currentPage,
      totalPages: Math.ceil(totalCount / resPerPage),
    });
  }
);

/**
 * 3. POST /api/v1/payouts/nursery/request
 * Request a new payout.
 * 🛡️ ACID Transaction + Strict balance validation + Concurrent request mutex.
 * Uses withTransaction() which gracefully degrades to non-transactional on
 * standalone MongoDB (local dev) — full ACID on Atlas/replica-set (production).
 */
export const requestPayout = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(new ErrorHandler("Please login to access this resource", 401));
    }
    const nurseryId = req.user._id;
    const { amount, payoutMethod, idempotencyKey } = req.body;

    const requestedAmount = Number(amount);
    if (!requestedAmount || isNaN(requestedAmount) || requestedAmount <= 0) {
      return next(new ErrorHandler("Please specify a valid payout amount greater than ₹0", 400));
    }

    // Minimum withdrawal threshold
    if (requestedAmount < 500) {
      return next(new ErrorHandler("Minimum withdrawal amount is ₹500", 400));
    }

    // 🔑 IDEMPOTENCY GUARD: If the same idempotencyKey already exists return the original record.
    // Prevents duplicate bank transfers when client retries on network timeout.
    if (idempotencyKey) {
      const existingByKey = await Payout.findOne({ idempotencyKey }).lean();
      if (existingByKey) {
        res.status(200).json({
          success: true,
          message: "Payout request already submitted (idempotent replay).",
          payout: existingByKey,
          idempotent: true,
        });
        return;
      }
    }

    // Verify bank details exist before allowing request
    const profile = await NurseryProfile.findOne({ nursery: nurseryId })
      .select("+bankDetails.accountNumber +bankDetails.ifscCode +bankDetails.bankName +bankDetails.accountHolderName")
      .lean();
    if (!profile?.bankDetails?.accountNumber || !profile?.bankDetails?.ifscCode) {
      return next(
        new ErrorHandler(
          "Bank details incomplete. Please configure your Account Number & IFSC code in Nursery Settings before requesting payouts.",
          400
        )
      );
    }

    // Capture an immutable snapshot of bank details for the audit trail
    const bankDetailsSnapshot = {
      accountNumber: profile.bankDetails.accountNumber,
      ifscCode: profile.bankDetails.ifscCode,
      bankName: profile.bankDetails.bankName || "",
      accountHolderName: profile.bankDetails.accountHolderName || "",
    };

    await withTransaction(async (session) => {
      // 🛡️ RACE CONDITION GUARD: Prevent concurrent pending requests
      const pendingQuery = Payout.findOne({
        nursery: nurseryId,
        status: { $in: ["PENDING", "PROCESSING"] },
      });
      if (session) pendingQuery.session(session);
      const existingPending = await pendingQuery;

      if (existingPending) {
        throw new ErrorHandler(
          `You already have an active payout request (#${existingPending._id}) with status ${existingPending.status}. Please wait for it to be settled before requesting another.`,
          400
        );
      }

      // 🛡️ AUTHORITATIVE BALANCE CHECK INSIDE TRANSACTION
      const summary = await calculateNurseryFinancialSummary(nurseryId, session);

      if (summary.hasNegativeBalance) {
        throw new ErrorHandler(
          `Cannot request payout. Your account has a negative balance of ₹${Math.abs(summary.availableBalance)} due to order cancellations. Future sales will automatically balance this deficit.`,
          400
        );
      }

      if (requestedAmount > summary.availableBalance) {
        throw new ErrorHandler(
          `Requested amount (₹${requestedAmount}) exceeds available balance (₹${summary.availableBalance}).`,
          400
        );
      }

      // Create Payout Record
      const createOpts = session ? { session } : {};
      const [newPayout] = await Payout.create(
        [
          {
            nursery: nurseryId,
            requestedAmount: roundMoney(requestedAmount),
            commissionDeducted: roundMoney(summary.totalCommission),
            netAmount: roundMoney(requestedAmount), // Requested amount IS the net (post-commission) withdrawal
            status: "PENDING",
            payoutMethod: payoutMethod || "BANK_TRANSFER",
            requestedAt: new Date(),
            ...(idempotencyKey ? { idempotencyKey } : {}),
            bankDetailsSnapshot,
            snapshot: {
              grossEarnings: summary.grossEarnings,
              totalCommission: summary.totalCommission,
              netEarnings: summary.netSales,
              previouslyPaidOut: summary.totalPaidOut,
              availableAtRequest: summary.availableBalance,
            },
          },
        ],
        createOpts
      );

      // 📒 Double-entry bookkeeping: Record PAYOUT_REQUESTED in transaction ledger
      await TransactionLedger.create(
        [
          {
            nursery: nurseryId,
            entryType: "PAYOUT_REQUESTED",
            amount: roundMoney(requestedAmount),
            direction: "DEBIT",
            description: `Payout requested — ID #${newPayout._id} for ₹${roundMoney(requestedAmount)}`,
            payoutId: newPayout._id,
            metadata: {
              adminNote: "Payout submitted by nursery",
            },
          },
        ],
        createOpts
      );

      res.status(201).json({
        success: true,
        message: `Payout request of ₹${roundMoney(requestedAmount)} submitted successfully. Funds will be transferred following verification.`,
        payout: newPayout,
      });

      // 📧 Non-blocking: Notify nursery that payout request was received
      if (req.user?.email) {
        sendPayoutStatusEmail(
          req.user.email,
          req.user.name || "Nursery Owner",
          roundMoney(requestedAmount),
          "Requested",
          newPayout._id.toString()
        ).catch((err) =>
          console.error("❌ [Email Trigger Failed] Event: PayoutStatus-Requested, Error:", err?.message)
        );
      }
    });
  }
);

/**
 * 4. GET /api/v1/payouts/nursery/commission-breakdown
 * Full transparent commission & cancellation reversal history for this nursery.
 */
export const getNurseryCommissionBreakdown = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(new ErrorHandler("Please login to access this resource", 401));
    }
    const nurseryId = req.user._id;
    const { page = 1, limit = 20 } = req.query;

    const currentPage = Math.max(1, Number(page));
    const resPerPage = Math.max(1, Number(limit));
    const skip = (currentPage - 1) * resPerPage;

    // Fetch ledger entries for full double-entry transparency
    const [totalLedgerCount, ledgerEntries] = await Promise.all([
      TransactionLedger.countDocuments({ nursery: nurseryId }),
      TransactionLedger.find({ nursery: nurseryId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(resPerPage)
        .populate("orderId", "orderStatus totalPrice createdAt")
        .lean(),
    ]);

    // Summary of reversals
    const reversalStats = await TransactionLedger.aggregate([
      { $match: { nursery: nurseryId, entryType: "COMMISSION_REVERSED" } },
      { $group: { _id: null, totalReversed: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);

    res.status(200).json({
      success: true,
      ledgerEntries,
      reversalSummary: {
        totalCommissionReversed: roundMoney(reversalStats[0]?.totalReversed || 0),
        cancellationCount: reversalStats[0]?.count || 0,
      },
      pagination: {
        totalCount: totalLedgerCount,
        currentPage,
        totalPages: Math.ceil(totalLedgerCount / resPerPage),
      },
    });
  }
);

// ======================================================================
// 🛡️ ADMIN PAYOUT ENDPOINTS
// ======================================================================

/**
 * 5. GET /api/v1/payouts/admin/list
 * Admin views all payouts across all nurseries with status filtering & search.
 */
export const getAdminPayoutsList = catchAsyncErrors(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { status, nurseryId, page = 1, limit = 15 } = req.query;

    const query: Record<string, any> = {};
    if (status && status !== "ALL") {
      query.status = status;
    }
    if (nurseryId) {
      query.nursery = nurseryId;
    }

    const currentPage = Math.max(1, Number(page));
    const resPerPage = Math.max(1, Number(limit));
    const skip = (currentPage - 1) * resPerPage;

    const [totalCount, payouts, globalFinancials] = await Promise.all([
      Payout.countDocuments(query),
      Payout.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(resPerPage)
        .populate("nursery", "name email phone avatar")
        .populate("processedBy", "name email")
        .lean(),
      calculateGlobalFinancialSummary(),
    ]);

    // Attach bank details snapshot to each payout for admin convenience
    const nurseryIds = payouts.map((p) => (p.nursery as any)?._id).filter(Boolean);
    const profiles = await NurseryProfile.find({ nursery: { $in: nurseryIds } })
      .select("+bankDetails.accountNumber +bankDetails.ifscCode")
      .lean();

    const profileMap = new Map<string, any>();
    profiles.forEach((p) => {
      profileMap.set(p.nursery.toString(), p);
    });

    const enrichedPayouts = payouts.map((p) => {
      const nid = (p.nursery as any)?._id?.toString();
      const prof = nid ? profileMap.get(nid) : null;
      return {
        ...p,
        bankDetails: prof?.bankDetails || null,
        nurseryBusinessName: prof?.businessName || (p.nursery as any)?.name || "Nursery",
      };
    });

    res.status(200).json({
      success: true,
      payouts: enrichedPayouts,
      globalFinancials,
      totalCount,
      currentPage,
      totalPages: Math.ceil(totalCount / resPerPage),
    });
  }
);


/**
 * 6. PATCH /api/v1/payouts/admin/:id/status
 * Admin updates payout status: PENDING -> PROCESSING -> COMPLETED or REJECTED.
 * 🛡️ ACID Transaction + Idempotent transition guard.
 * Uses withTransaction() which gracefully degrades on standalone MongoDB.
 */
export const adminUpdatePayoutStatus = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(new ErrorHandler("Please login to access this resource", 401));
    }
    const rawId = req.params.id || (req.params as any).payoutId;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId || "").trim();

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return next(new ErrorHandler(`Invalid payout ID format: "${id || "empty"}"`, 400));
    }

    const { utrNumber, rejectionReason, adminNote } = req.body;
    const rawStatus = req.body?.status;
    const status = String(rawStatus || "").trim().toUpperCase();

    const validStatuses = ["PROCESSING", "COMPLETED", "REJECTED"];
    if (!validStatuses.includes(status)) {
      return next(
        new ErrorHandler(
          `Invalid status "${rawStatus}". Must be one of: ${validStatuses.join(", ")}`,
          400
        )
      );
    }

    if (status === "COMPLETED" && (!utrNumber || !String(utrNumber).trim())) {
      return next(
        new ErrorHandler(
          "UTR / Bank Reference number is required when marking a payout as COMPLETED.",
          400
        )
      );
    }

    if (status === "REJECTED" && (!rejectionReason || !String(rejectionReason).trim())) {
      return next(
        new ErrorHandler(
          "Rejection reason is required when rejecting a payout request.",
          400
        )
      );
    }

    let updatedPayout: any;

    await withTransaction(async (session) => {
      const findQuery = Payout.findById(id);
      if (session) findQuery.session(session);
      const payout = await findQuery;

      if (!payout) {
        throw new ErrorHandler("Payout record not found", 404);
      }

      // 🛡️ IDEMPOTENCY & TERMINAL STATE GUARD
      if (payout.status === "COMPLETED") {
        throw new ErrorHandler("This payout has already been COMPLETED and cannot be altered.", 400);
      }

      if (payout.status === "REJECTED") {
        throw new ErrorHandler("This payout has already been REJECTED and cannot be altered.", 400);
      }

      // Apply updates
      payout.status = status as any;
      payout.processedBy = req.user!._id;

      const createOpts = session ? { session } : {};

      if (status === "COMPLETED") {
        payout.processedAt = new Date();
        payout.utrNumber = String(utrNumber).trim();

        // 📒 Double-entry bookkeeping: Record PAYOUT_COMPLETED
        await TransactionLedger.create(
          [
            {
              nursery: payout.nursery,
              entryType: "PAYOUT_COMPLETED",
              amount: payout.requestedAmount,
              direction: "DEBIT",
              description: `Payout settled by Admin — UTR: ${String(utrNumber).trim()} | Amount: ₹${payout.requestedAmount}`,
              payoutId: payout._id,
              metadata: {
                utrNumber: String(utrNumber).trim(),
                adminNote: adminNote ? String(adminNote).trim() : "Settled via bank transfer",
              },
            },
          ],
          createOpts
        );
      } else if (status === "REJECTED") {
        payout.processedAt = new Date();
        payout.rejectionReason = String(rejectionReason).trim();

        // 📒 Double-entry bookkeeping: Record PAYOUT_REJECTED (release the reserved amount)
        await TransactionLedger.create(
          [
            {
              nursery: payout.nursery,
              entryType: "PAYOUT_REJECTED",
              amount: payout.requestedAmount,
              direction: "CREDIT",
              description: `Payout request rejected — Reason: ${String(rejectionReason).trim()}`,
              payoutId: payout._id,
              metadata: {
                adminNote: String(rejectionReason).trim(),
              },
            },
          ],
          createOpts
        );
      } else if (status === "PROCESSING") {
        payout.processedAt = new Date();
      }

      const saveOpts = session ? { session } : {};
      await payout.save(saveOpts);
      updatedPayout = payout;
    });

    res.status(200).json({
      success: true,
      message: `Payout #${updatedPayout?._id || id} successfully updated to ${status}.`,
      payout: updatedPayout,
    });

    // 📧 Non-blocking: Notify nursery vendor about payout status change
    if (updatedPayout) {
      const nurseryStatusMap: Record<string, "Requested" | "Approved" | "Completed" | "Rejected"> = {
        PROCESSING: "Approved",
        COMPLETED: "Completed",
        REJECTED: "Rejected",
      };
      const emailStatus = nurseryStatusMap[status];
      if (emailStatus) {
        // Fetch nursery user for email/name
        const { default: User } = await import("../models/userModel");
        const nurseryUser = await User.findById(updatedPayout.nursery).select("name email").lean();
        if (nurseryUser?.email) {
          const note = status === "COMPLETED"
            ? `UTR Reference: ${utrNumber}`
            : status === "REJECTED"
            ? `Reason: ${rejectionReason}`
            : "Your payout is being processed.";

          sendPayoutStatusEmail(
            nurseryUser.email,
            (nurseryUser as any).name || "Nursery Owner",
            updatedPayout.requestedAmount,
            emailStatus,
            updatedPayout._id.toString(),
            note
          ).catch((err) =>
            console.error(`❌ [Email Trigger Failed] Event: PayoutStatus-${emailStatus}, Error:`, err?.message)
          );
        }
      }
    }
  }
);
