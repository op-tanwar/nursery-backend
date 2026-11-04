import mongoose, { Schema, model } from "mongoose";
import { IReturnReplacementRequest } from "../types/returnReplacement.types";

const returnReplacementRequestSchema = new Schema<IReturnReplacementRequest>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: [true, "Order reference is required."],
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
    itemId: {
      type: Schema.Types.Mixed,
      required: [true, "Item reference is required."],
      index: true,
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
    requestType: {
      type: String,
      required: [true, "Request type is required."],
      enum: {
        values: ["Return", "Replacement"],
        message: "Request type must be either 'Return' or 'Replacement'.",
      },
    },
    reason: {
      type: String,
      required: [true, "Reason for return or replacement is required."],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    proofImages: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Completed"],
      default: "Pending",
      index: true,
    },
    adminNotes: {
      type: String,
      trim: true,
      default: "",
    },
    resolvedAt: {
      type: Date,
    },
    isProcessed: {
      type: Boolean,
      default: false,
      index: true,
    },
    refundDetails: {
      refundId: { type: String, trim: true },
      refundStatus: {
        type: String,
        enum: ["PENDING", "PROCESSED", "FAILED", "PENDING_MANUAL_REVIEW"],
      },
      refundAmount: { type: Number, default: 0 },
      refundedAt: { type: Date },
      failureReason: { type: String, trim: true },
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
  }
);

// Compound index to avoid duplicate requests for the same line item
returnReplacementRequestSchema.index({ orderId: 1, itemId: 1 }, { unique: true });

export default mongoose.models.ReturnReplacementRequest ||
  model<IReturnReplacementRequest>("ReturnReplacementRequest", returnReplacementRequestSchema);
