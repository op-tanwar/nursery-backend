import mongoose, { Schema, Document, Types } from "mongoose";

export interface IStockReservationItem {
  productId: Types.ObjectId;
  itemModel: string;
  quantity: number;
  name?: string;
  price?: number;
}

export interface IStockReservation extends Document {
  razorpayOrderId: string;
  userId: Types.ObjectId;
  items: IStockReservationItem[];
  status: "PENDING" | "COMMITTED" | "RELEASED";
  expiresAt: Date;
  committedAt?: Date;
  releasedAt?: Date;
  releaseReason?: string;
  refundId?: string;
  refundStatus?: string;
  refundAmount?: number;
  createdAt: Date;
  updatedAt: Date;
}

const stockReservationItemSchema = new Schema<IStockReservationItem>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    itemModel: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1"],
    },
    name: {
      type: String,
      trim: true,
    },
    price: {
      type: Number,
    },
  },
  { _id: false }
);

const stockReservationSchema = new Schema<IStockReservation>(
  {
    razorpayOrderId: {
      type: String,
      required: [true, "Razorpay Order ID is required"],
      unique: true,
      trim: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      index: true,
    },
    items: {
      type: [stockReservationItemSchema],
      required: true,
      validate: [
        (val: IStockReservationItem[]) => val.length > 0,
        "Stock reservation must contain at least one item",
      ],
    },
    status: {
      type: String,
      enum: ["PENDING", "COMMITTED", "RELEASED"],
      default: "PENDING",
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    committedAt: {
      type: Date,
    },
    releasedAt: {
      type: Date,
    },
    releaseReason: {
      type: String,
      trim: true,
    },
    refundId: {
      type: String,
      trim: true,
    },
    refundStatus: {
      type: String,
      trim: true,
    },
    refundAmount: {
      type: Number,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Index for background sweeper finding expired pending reservations quickly
stockReservationSchema.index({ status: 1, expiresAt: 1 });

const StockReservation = mongoose.model<IStockReservation>(
  "StockReservation",
  stockReservationSchema
);

export default StockReservation;
