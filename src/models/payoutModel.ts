import mongoose, { Schema, Document, Types } from "mongoose";
// ======================================================================
// 💰 PAYOUT MODEL — Nursery Payout Request & Settlement Ledger
// ======================================================================
export type PayoutStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "REJECTED";
export type PayoutMethod = "BANK_TRANSFER" | "UPI" | "MANUAL";

export interface IPayoutBankSnapshot {
  accountNumber?: string;
  ifscCode?: string;
  bankName?: string;
  accountHolderName?: string;
  upiId?: string;
}

export interface IPayout extends Document {
  nursery: Types.ObjectId;
  requestedAmount: number;
  /** Platform commission deducted from gross (informational snapshot) */
  commissionDeducted: number;
  /** Net amount after commission — for bank transfer matching */
  netAmount: number;
  status: PayoutStatus;
  payoutMethod: PayoutMethod;
  requestedAt: Date;
  processedAt?: Date;
  utrNumber?: string;
  rejectionReason?: string;
  /** Reason payment failed (e.g. bank bounce) */
  failureReason?: string;
  /** Idempotency key from client to prevent duplicate submissions on network retry */
  idempotencyKey?: string;
  /** Snapshot of bank details at time of request (immutable audit trail) */
  bankDetailsSnapshot?: IPayoutBankSnapshot;
  /** Snapshot of financial state at time of request */
  snapshot: {
    grossEarnings: number;
    totalCommission: number;
    netEarnings: number;
    previouslyPaidOut: number;
    availableAtRequest: number;
  };
  /** Admin who processed this payout (if applicable) */
  processedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const bankSnapshotSchema = new Schema<IPayoutBankSnapshot>(
  {
    accountNumber: { type: String },
    ifscCode: { type: String },
    bankName: { type: String },
    accountHolderName: { type: String },
    upiId: { type: String },
  },
  { _id: false }
);

const payoutSchema = new Schema<IPayout>(
  {
    nursery: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requestedAmount: {
      type: Number,
      required: true,
      min: [500, "Payout amount must be at least ₹500"],
    },
    commissionDeducted: {
      type: Number,
      default: 0,
    },
    netAmount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "COMPLETED", "REJECTED"],
      default: "PENDING",
      required: true,
    },
    payoutMethod: {
      type: String,
      enum: ["BANK_TRANSFER", "UPI", "MANUAL"],
      default: "BANK_TRANSFER",
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    processedAt: {
      type: Date,
    },
    utrNumber: {
      type: String,
      trim: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    failureReason: {
      type: String,
      trim: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      sparse: true, // Unique per nursery — allows nulls but enforces uniqueness when set
    },
    bankDetailsSnapshot: {
      type: bankSnapshotSchema,
    },
    snapshot: {
      grossEarnings: { type: Number, default: 0 },
      totalCommission: { type: Number, default: 0 },
      netEarnings: { type: Number, default: 0 },
      previouslyPaidOut: { type: Number, default: 0 },
      availableAtRequest: { type: Number, default: 0 },
    },
    processedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// ── Indexes for fast nursery ledger lookups ──────────────────────────────────
payoutSchema.index({ nursery: 1, createdAt: -1 });
payoutSchema.index({ nursery: 1, status: 1 });
payoutSchema.index({ status: 1 });
// Sparse unique index on idempotencyKey — prevents duplicate submissions on network retry
payoutSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export default mongoose.model<IPayout>("Payout", payoutSchema);