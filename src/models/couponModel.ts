import mongoose, { Schema, Document } from "mongoose";

export interface ICoupon extends Document {
  code: string;
  discountType: "flat" | "percentage";
  discountValue: number;
  minCartValue: number;
  expiryDate: Date;
  isActive: boolean;
  usedBy: mongoose.Types.ObjectId[];
}

const couponSchema = new Schema<ICoupon>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountType: { type: String, enum: ["flat", "percentage"], required: true },
    discountValue: { type: Number, required: true },
    minCartValue: { type: Number, default: 0 },
    expiryDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    // NOTE: Keep usedBy tracked via single array vectors since coupon reuse limits typically apply strictly per individual context.
    usedBy: [{ type: Schema.Types.ObjectId, ref: "User", index: true }]
  },
  { timestamps: true }
);

export default mongoose.model<ICoupon>("Coupon", couponSchema);