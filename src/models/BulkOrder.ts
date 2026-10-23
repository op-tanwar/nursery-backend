import mongoose, { Schema } from "mongoose";
import validator from "validator";
import {
  IBulkOrderDocument,
  BULK_ORDER_STATUSES,
  BULK_ORDER_PRODUCT_TYPES,
} from "../types/bulkOrder.types";

const bulkOrderSchema = new Schema<IBulkOrderDocument>(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    phoneNumber: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      validate: {
        validator: function (v: string) {
          if (!v) return true;
          return validator.isEmail(v);
        },
        message: "Please provide a valid email address",
      },
    },
    city: {
      type: String,
      required: [true, "City is required"],
      trim: true,
    },
    state: {
      type: String,
      required: [true, "State is required"],
      trim: true,
    },
    productType: {
      type: String,
      required: [true, "Product type is required"],
      enum: {
        values: BULK_ORDER_PRODUCT_TYPES,
        message:
          "Product type must be one of: plants, pots, fertilizers, services, accessories, mixed",
      },
      lowercase: true,
      trim: true,
    },
    estimatedQuantity: {
      type: Number,
      required: [true, "Estimated quantity is required"],
      min: [1, "Estimated quantity must be at least 1"],
    },
    message: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: {
        values: BULK_ORDER_STATUSES,
        message:
          "Status must be one of: Pending, In Discussion, Quoted, Fulfilled, Cancelled",
      },
      default: "Pending",
    },
    adminNotes: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

// Indexes for fast searching & filtering
bulkOrderSchema.index({ status: 1, createdAt: -1 });
bulkOrderSchema.index({ fullName: "text", city: "text", phoneNumber: "text" });

const BulkOrder =
  mongoose.models.BulkOrder ||
  mongoose.model<IBulkOrderDocument>("BulkOrder", bulkOrderSchema);

export default BulkOrder;
