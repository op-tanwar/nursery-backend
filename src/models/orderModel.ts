import mongoose, { Schema, model } from "mongoose";
import { IOrder } from "../types/order.types";

const orderSchema = new Schema<IOrder>(
  {
    shippingInfo: {
      name: { type: String, required: true, trim: true },
      phone: { type: String, required: true },
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      country: { type: String, required: true },
      pinCode: { type: String, required: true },
    },

    orderItems: [
      {
        itemModel: {
          type: String,
          required: true,
          enum: [
            "Plant",
            "Pot",
            "Accessory",
            "GardeningTool",
            "PlantCare",
            "SeedsBulbs",
            "PlantStandsShelves",
            "ArtificialDriedPlant"
          ],
        },
        item: {
          type: Schema.Types.ObjectId,
          required: true,
          refPath: "orderItems.itemModel",
        },
        quantity: { type: Number, required: true, min: [1, "Quantity cannot be less than 1"] },
        price: { type: Number, required: true },
        priceAtPurchase: { type: Number, required: true },
        originalPrice: { type: Number },
        discountPrice: { type: Number, default: 0 },
        taxAmount: { type: Number, required: true, default: 0 },
        taxRatePercentage: { type: Number, required: true, default: 0 },
        taxCategory: { type: String, default: "General" },
        isTaxInclusive: { type: Boolean, default: false },
        commissionRatePercentage: { type: Number, default: 0 },
        commissionAmount: { type: Number, default: 0 },
        nurseryEarnings: { type: Number, default: 0 },
        nursery: {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        status: {
          type: String,
          required: true,
          default: "Processing",
          enum: ["Processing", "Shipped", "Out for Delivery", "Delivered", "Cancelled", "Claimed"],
        },
        claim: {
          isClaimed: { type: Boolean, default: false },
          claimType: { type: String, enum: ["Replacement", "Refund"] },
          reason: { type: String },
          proofUrl: { type: String },
          status: {
            type: String,
            enum: ["Pending", "Approved", "Rejected"],
            default: "Pending"
          },
          claimedAt: { type: Date }
        }
      },
    ],

    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    paymentInfo: {
      id: { type: String, required: true },
      orderId: { type: String, required: true },
      status: { type: String, required: true },
    },

    itemsPrice: { type: Number, required: true, default: 0 },
    taxPrice: { type: Number, required: true, default: 0 },
    shippingPrice: { type: Number, required: true, default: 0 },
    totalPrice: { type: Number, required: true, default: 0 },

    orderStatus: {
      type: String,
      required: true,
      default: "Processing",
      enum: ["Processing", "Shipped", "Out for Delivery", "Delivered", "Cancelled"],
    },
    paidAt: { type: Date, required: true, default: Date.now },
    deliveredAt: Date,
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ user: 1 });
orderSchema.index({ "orderItems.nursery": 1, createdAt: -1 });
orderSchema.index({ "orderItems.nursery": 1, orderStatus: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ "paymentInfo.orderId": 1 });

// 🛡️ FIXED: High-performance compound unique processing check configuration added to intercept fast multi-submit/replay queries
orderSchema.index({ "paymentInfo.id": 1 }, { unique: true, sparse: true });

export default model<IOrder>("Order", orderSchema);