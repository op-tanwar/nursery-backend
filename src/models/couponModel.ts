import mongoose, { Schema, Document } from "mongoose";

export interface ICoupon extends Document {
  code: string;
  discountType: "flat" | "percentage";
  discountValue: number;
  minCartValue: number;
  minOrderValue?: number;
  maxDiscountAmount?: number;
  usageLimit?: number;
  usedCount: number;
  startDate?: Date;
  expiryDate: Date;
  endDate?: Date;
  isActive: boolean;
  usedBy: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const couponSchema = new Schema<ICoupon>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountType: { type: String, enum: ["flat", "percentage"], required: true, lowercase: true },
    discountValue: { type: Number, required: true, min: 0 },
    minCartValue: { type: Number, default: 0, min: 0 },
    maxDiscountAmount: { type: Number, default: undefined },
    usageLimit: { type: Number, default: undefined },
    usedCount: { type: Number, default: 0, min: 0 },
    startDate: { type: Date, default: Date.now },
    expiryDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    // NOTE: Keep usedBy tracked via single array vectors since coupon reuse limits typically apply strictly per individual context.
    usedBy: [{ type: Schema.Types.ObjectId, ref: "User", index: true }]
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual field mappings for frontend/backend attribute symmetry
couponSchema.virtual("minOrderValue")
  .get(function () {
    return this.minCartValue;
  })
  .set(function (val: number) {
    this.minCartValue = val;
  });

couponSchema.virtual("endDate")
  .get(function () {
    return this.expiryDate;
  })
  .set(function (val: Date) {
    this.expiryDate = val;
  });

// Pre-validate synchronization hook
couponSchema.pre("validate", function () {
  if (this.code) {
    this.code = this.code.trim().toUpperCase();
  }
  if (this.discountType) {
    this.discountType = String(this.discountType).toLowerCase() as "flat" | "percentage";
  }
  if ((this as any).minOrderValue !== undefined && this.minCartValue === undefined) {
    this.minCartValue = (this as any).minOrderValue;
  }
  if ((this as any).endDate && !this.expiryDate) {
    this.expiryDate = (this as any).endDate;
  }
});

export default mongoose.model<ICoupon>("Coupon", couponSchema);
