/**
 * ============================================================
 * 📒 TRANSACTION LEDGER — Double-Entry Bookkeeping Model
 * ============================================================
 * Every financial event creates an immutable ledger entry.
 * Entries are append-only — never updated or deleted.
 *
 * Entry types:
 *   COMMISSION_CHARGED     → When an order item is sold (debit from nursery)
 *   COMMISSION_REVERSED    → When a sold item is cancelled (credit to nursery)
 *   PAYOUT_REQUESTED       → When nursery requests a withdrawal
 *   PAYOUT_COMPLETED       → When admin marks payout as done
 *   PAYOUT_REJECTED        → When admin rejects a payout request
 *
 * Balance Rule:
 *   availableBalance = SUM(COMMISSION_REVERSED) - SUM(COMMISSION_CHARGED)
 *                    + [net sales from orders] - SUM(PAYOUT_COMPLETED)
 * ============================================================
 */

import mongoose, { Schema, Document, Types } from "mongoose";

export type LedgerEntryType =
  | "COMMISSION_CHARGED"
  | "COMMISSION_REVERSED"
  | "PAYOUT_REQUESTED"
  | "PAYOUT_COMPLETED"
  | "PAYOUT_REJECTED"
  | "FALLBACK_REFUND"
  | "STOCK_COLLISION_REFUND";

export interface ITransactionLedger extends Document {
  /** The nursery this entry belongs to (optional for platform/customer fallback refunds) */
  nursery?: Types.ObjectId;
  /** Entry type — determines debit/credit direction */
  entryType: LedgerEntryType;
  /** Amount in RUPEES (stored with 2dp precision) */
  amount: number;
  /** Positive = credit to nursery; Negative = debit from nursery */
  direction: "CREDIT" | "DEBIT";
  /** Human-readable description */
  description: string;

  // Reference links
  orderId?: Types.ObjectId;
  orderItemId?: Types.ObjectId;
  payoutId?: Types.ObjectId;

  /** Snapshot context — what triggered this entry */
  metadata: {
    itemModel?: string;
    itemName?: string;
    commissionRate?: number;
    lineGross?: number;
    quantity?: number;
    utrNumber?: string;
    adminNote?: string;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    refundId?: string;
    reason?: string;
    customerEmail?: string;
  };

  /** Running balance AFTER this entry was applied (denormalized for fast reads) */
  runningBalance?: number;

  createdAt: Date;
  updatedAt: Date;
}

const transactionLedgerSchema = new Schema<ITransactionLedger>(
  {
    nursery: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    entryType: {
      type: String,
      enum: [
        "COMMISSION_CHARGED",
        "COMMISSION_REVERSED",
        "PAYOUT_REQUESTED",
        "PAYOUT_COMPLETED",
        "PAYOUT_REJECTED",
        "FALLBACK_REFUND",
        "STOCK_COLLISION_REFUND",
      ],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    direction: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },

    // Reference links (optional — at least one should be set)
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
    },
    orderItemId: {
      type: Schema.Types.ObjectId,
    },
    payoutId: {
      type: Schema.Types.ObjectId,
      ref: "Payout",
    },

    metadata: {
      itemModel: { type: String },
      itemName: { type: String },
      commissionRate: { type: Number },
      lineGross: { type: Number },
      quantity: { type: Number },
      utrNumber: { type: String },
      adminNote: { type: String },
      razorpayOrderId: { type: String },
      razorpayPaymentId: { type: String },
      refundId: { type: String },
      reason: { type: String },
      customerEmail: { type: String },
    },

    runningBalance: {
      type: Number,
    },
  },
  {
    timestamps: true,
    // Ledger entries are immutable — block updates
  }
);

// Indexes for fast per-nursery ledger queries
transactionLedgerSchema.index({ nursery: 1, createdAt: -1 });
transactionLedgerSchema.index({ nursery: 1, entryType: 1 });
transactionLedgerSchema.index({ orderId: 1 });
transactionLedgerSchema.index({ payoutId: 1 });

export default mongoose.model<ITransactionLedger>(
  "TransactionLedger",
  transactionLedgerSchema
);
