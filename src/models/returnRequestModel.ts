import mongoose, { Schema, model } from "mongoose";
import { IReturnRequest } from "../types/returnRequest.types";

const returnRequestSchema = new Schema<IReturnRequest>(
  {
    order: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: [true, "Order reference is required."],
      index: true,
    },
    orderItem: {
      type: Schema.Types.ObjectId,
      required: [true, "Order item reference is required."],
      index: true,
    },
    product: {
      type: Schema.Types.ObjectId,
      required: [true, "Product reference is required."],
      index: true,
    },
    productModel: {
      type: String,
      trim: true,
      default: "Plant",
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
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Customer user reference is required."],
      index: true,
    },
    nursery: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Nursery reference is required."],
      index: true,
    },
    requestType: {
      type: String,
      required: [true, "Request type must be specified."],
      enum: {
        values: ["Return", "Replacement"],
        message: "Request type must be either 'Return' or 'Replacement'.",
      },
    },
    reason: {
      type: String,
      required: [true, "Reason for return or replacement is required."],
      enum: {
        values: [
          "Damaged Plant/Pot",
          "Wrong Item Received",
          "Poor Plant Quality",
          "Other",
        ],
        message: "Invalid reason selected.",
      },
    },
    description: {
      type: String,
      required: [true, "Detailed issue description is required."],
      trim: true,
      minlength: [20, "Detailed description must contain at least 20 characters."],
    },
    proofImages: {
      type: [String],
      required: [true, "At least one proof image is required."],
      validate: {
        validator: function (v: string[]) {
          return Array.isArray(v) && v.length > 0;
        },
        message: "Please upload at least 1 proof photograph.",
      },
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Completed"],
      default: "Pending",
      index: true,
    },
    adminComments: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to avoid duplicate requests for the same line item
returnRequestSchema.index({ order: 1, orderItem: 1 }, { unique: true });

export default mongoose.models.ReturnRequest ||
  model<IReturnRequest>("ReturnRequest", returnRequestSchema);
