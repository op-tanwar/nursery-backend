import mongoose, { Schema, model } from "mongoose";
import { IClaimRequest } from "../types/claim.types";

const claimRequestSchema = new Schema<IClaimRequest>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: [true, "Order reference is required."],
      index: true,
    },
    itemId: {
      type: Schema.Types.Mixed,
      required: [true, "Item reference is required."],
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User reference is required."],
      index: true,
    },
    nurseryId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Nursery reference is required."],
      index: true,
    },
    type: {
      type: String,
      required: [true, "Claim/Request type is required."],
      enum: {
        values: [
          "RETURN",
          "REPLACEMENT",
          "DAMAGE_CLAIM",
          "Return",
          "Replacement",
          "Damage Claim",
        ],
        message: "Type must be 'RETURN', 'REPLACEMENT', or 'DAMAGE_CLAIM'.",
      },
      default: "RETURN",
      index: true,
    },
    requestType: {
      type: String,
      default: function () {
        return (this as any).type || "RETURN";
      },
    },
    reason: {
      type: String,
      required: [true, "Reason for claim or return is required."],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    images: {
      type: [String],
      default: [],
    },
    proofImages: {
      type: [String],
      default: [],
    },
    unboxingVideoUrl: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: [
        "PENDING",
        "APPROVED",
        "REJECTED",
        "COMPLETED",
        "Pending",
        "Approved",
        "Rejected",
        "Completed",
      ],
      default: "PENDING",
      index: true,
    },
    adminNotes: {
      type: String,
      trim: true,
      default: "",
    },
    adminComments: {
      type: String,
      trim: true,
      default: "",
    },
    refundStatus: {
      type: String,
      enum: [
        "NONE",
        "PENDING",
        "PROCESSED",
        "FAILED",
        "PENDING_MANUAL_REVIEW",
      ],
      default: "NONE",
      index: true,
    },
    refundDetails: {
      refundId: { type: String, trim: true },
      refundStatus: {
        type: String,
        enum: ["NONE", "PENDING", "PROCESSED", "FAILED", "PENDING_MANUAL_REVIEW"],
        default: "NONE",
      },
      refundAmount: { type: Number, default: 0 },
      refundedAt: { type: Date },
      failureReason: { type: String, trim: true },
    },
    trackingInfo: {
      carrier: { type: String, trim: true, default: "" },
      trackingNumber: { type: String, trim: true, default: "" },
      trackingUrl: { type: String, trim: true, default: "" },
      dispatchedAt: { type: Date },
      deliveredAt: { type: Date },
    },
    productName: {
      type: String,
      trim: true,
      default: "Botanical Item",
    },
    productImage: {
      type: String,
      trim: true,
      default: "",
    },
    productModel: {
      type: String,
      trim: true,
      default: "Plant",
    },
    replacementOrderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      index: true,
    },
    inventoryAction: {
      type: String,
      enum: ["RESTOCKED", "DEFECTIVE_RECORDED", "REPLACEMENT_DISPATCHED", "NONE"],
      default: "NONE",
    },
    isProcessed: {
      type: Boolean,
      default: false,
      index: true,
    },
    resolvedAt: {
      type: Date,
    },
    timeline: [
      {
        status: { type: String, required: true },
        action: { type: String, required: true },
        actor: { type: Schema.Types.ObjectId, ref: "User" },
        actorRole: { type: String, default: "admin" },
        notes: { type: String, default: "" },
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Bidirectional synchronization pre-validation hook
claimRequestSchema.pre("validate", function () {
  // Sync type <-> requestType
  if (!this.type && this.requestType) {
    this.type = this.requestType;
  }
  if (!this.requestType && this.type) {
    this.requestType = this.type;
  }

  // Normalize images <-> proofImages
  if ((!this.images || this.images.length === 0) && this.proofImages && this.proofImages.length > 0) {
    this.images = [...this.proofImages];
  }
  if ((!this.proofImages || this.proofImages.length === 0) && this.images && this.images.length > 0) {
    this.proofImages = [...this.images];
  }

  // Sync adminNotes <-> adminComments
  if (!this.adminNotes && this.adminComments) {
    this.adminNotes = this.adminComments;
  }
  if (!this.adminComments && this.adminNotes) {
    this.adminComments = this.adminNotes;
  }
});

// Backward-compatible virtual aliases for legacy queries / serialization
claimRequestSchema.virtual("order").get(function () {
  return this.orderId;
});
claimRequestSchema.virtual("orderItem").get(function () {
  return this.itemId;
});
claimRequestSchema.virtual("product").get(function () {
  return this.itemId;
});
claimRequestSchema.virtual("user").get(function () {
  return this.userId;
});
claimRequestSchema.virtual("nursery").get(function () {
  return this.nurseryId;
});

// Compound unique index to prevent duplicate concurrent claims on the same order item
claimRequestSchema.index({ orderId: 1, itemId: 1 }, { unique: true });

export const ClaimRequest =
  mongoose.models.ClaimRequest ||
  model<IClaimRequest>("ClaimRequest", claimRequestSchema);

export default ClaimRequest;
