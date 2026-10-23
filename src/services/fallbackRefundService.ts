import mongoose, { Types } from "mongoose";
import { getRazorpayInstance } from "./razorpay";
import TransactionLedger from "../models/transactionLedgerModel";
import StockReservation from "../models/stockReservationModel";
import { sendFallbackRefundEmail, sendAdminStockCollisionAlert } from "./emailService";
import { toRupees } from "../utils/pricingUtils";

export interface FallbackRefundParams {
  razorpayPaymentId: string;
  razorpayOrderId: string;
  amountPaise: number;
  userId?: Types.ObjectId | string;
  customerEmail?: string;
  customerName?: string;
  reason: string;
  orderItems?: any[];
  metadata?: Record<string, any>;
}

export interface FallbackRefundResult {
  success: boolean;
  refundId?: string;
  refundAmountRupees: number;
  ledgerEntryId?: string;
  error?: string;
}

/**
 * 💸 Automated Razorpay Fallback Refund Engine
 *
 * Triggered when a payment succeeds at the gateway, but:
 * - The 15-minute stock reservation TTL expired and inventory was claimed by another customer.
 * - An inventory collision occurred and stock is completely exhausted.
 *
 * Executes:
 * 1. Gateway refund call via Razorpay SDK.
 * 2. Immutable double-entry bookkeeping in TransactionLedger ("FALLBACK_REFUND").
 * 3. StockReservation record update with refund details.
 * 4. Transactional customer refund notification email with formatted receipt.
 */
export const processFallbackRefund = async (
  params: FallbackRefundParams
): Promise<FallbackRefundResult> => {
  const refundAmountRupees = toRupees(params.amountPaise);

  try {
    console.warn(
      `💸 [FallbackRefund] Initiating automated refund for Payment: ${params.razorpayPaymentId}, Order: ${params.razorpayOrderId}, Amount: ₹${refundAmountRupees} (Paise: ${params.amountPaise}). Reason: ${params.reason}`
    );

    const razorpay = getRazorpayInstance();
    const refund = await razorpay.payments.refund(params.razorpayPaymentId, {
      amount: params.amountPaise,
      notes: {
        reason: params.reason,
        razorpayOrderId: params.razorpayOrderId,
        userId: params.userId ? params.userId.toString() : "",
      },
    });

    console.log(
      `✅ [FallbackRefund] Gateway refund successful. Refund ID: ${refund.id}`
    );

    // 📒 2. Double-entry bookkeeping ledger entry
    const ledger = await TransactionLedger.create({
      entryType: "FALLBACK_REFUND",
      amount: refundAmountRupees,
      direction: "DEBIT",
      description: `Automated fallback refund (${refund.id}) for Razorpay payment ${params.razorpayPaymentId} on order ${params.razorpayOrderId}. Reason: ${params.reason}`,
      metadata: {
        razorpayOrderId: params.razorpayOrderId,
        razorpayPaymentId: params.razorpayPaymentId,
        refundId: refund.id,
        reason: params.reason,
        customerEmail: params.customerEmail,
        ...params.metadata,
      },
    });

    // 📋 3. Update reservation status if present
    await StockReservation.findOneAndUpdate(
      { razorpayOrderId: params.razorpayOrderId },
      {
        refundId: refund.id,
        refundStatus: refund.status || "processed",
        refundAmount: refundAmountRupees,
        releaseReason: `REFUNDED_${params.reason}`,
      }
    );

    // 📧 4. Send customer notification email & Super Admin anomaly alert
    if (params.customerEmail) {
      sendFallbackRefundEmail({
        customerEmail: params.customerEmail,
        customerName: params.customerName || "Valued Customer",
        orderId: params.razorpayOrderId,
        amount: refundAmountRupees,
        refundId: refund.id,
        reason: params.reason,
      }).catch((err) => {
        console.error(`🚨 [FallbackRefund] Failed to send customer refund email:`, err);
      });
    }

    // 🚨 5. Alert Super Admin about stock collision / inventory exhaustion anomaly
    sendAdminStockCollisionAlert({
      orderId: params.razorpayOrderId,
      paymentId: params.razorpayPaymentId,
      amount: refundAmountRupees,
      customerName: params.customerName || "Customer",
      customerEmail: params.customerEmail || "Not provided",
      refundId: refund.id,
      reason: params.reason,
      items: params.orderItems,
    }).catch((err) => {
      console.error(`🚨 [FallbackRefund] Failed to send admin stock collision alert:`, err);
    });

    return {
      success: true,
      refundId: refund.id,
      refundAmountRupees,
      ledgerEntryId: ledger._id.toString(),
    };
  } catch (error: any) {
    console.error(
      `🚨 [FallbackRefund] Fatal error executing automated refund for payment ${params.razorpayPaymentId}:`,
      error
    );

    // Record ledger entry even if refund gateway threw to track financial discrepancy
    try {
      await TransactionLedger.create({
        entryType: "FALLBACK_REFUND",
        amount: refundAmountRupees,
        direction: "DEBIT",
        description: `FAILED automated fallback refund attempt for ${params.razorpayPaymentId}. Gateway error: ${error.message}`,
        metadata: {
          razorpayOrderId: params.razorpayOrderId,
          razorpayPaymentId: params.razorpayPaymentId,
          reason: params.reason,
          customerEmail: params.customerEmail,
          gatewayError: error.message,
        },
      });
    } catch (ledgerErr) {
      console.error(
        `🚨 [FallbackRefund] Failed to record failed refund in ledger:`,
        ledgerErr
      );
    }

    return {
      success: false,
      refundAmountRupees,
      error: error.message,
    };
  }
};
