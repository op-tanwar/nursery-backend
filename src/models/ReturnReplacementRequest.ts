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
  },
  {
    timestamps: true,
  }
);

// Compound index to avoid duplicate requests for the same line item
returnReplacementRequestSchema.index({ orderId: 1, itemId: 1 }, { unique: true });

export default mongoose.models.ReturnReplacementRequest ||
  model<IReturnReplacementRequest>("ReturnReplacementRequest", returnReplacementRequestSchema);
