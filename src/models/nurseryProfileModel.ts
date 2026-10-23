import mongoose, { Schema } from "mongoose";
import slugify from "slugify";
import { INurseryProfile } from "../types/nursery.types";

const nurseryProfileSchema = new Schema<INurseryProfile>(
  {
    nursery: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    businessName: { type: String, required: true, trim: true },
    slug: {
      type: String,
      unique: true,
      sparse: true,   // Allow multiple docs with null slug without unique-key conflicts
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "Curating rare houseplants, handcrafted ceramic pots, and premium organic soils. Bringing nature closer to your living spaces with sustainable and healthy greenery.",
    },
    coverImage: {
      public_id: { type: String },
      url: { type: String, default: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&q=80&w=1600" },
    },
    rating: {
      type: Number,
      default: 4.8,
    },
    numOfReviews: {
      type: Number,
      default: 124,
    },
    businessEmail: { type: String, required: true, trim: true, lowercase: true },
    businessPhone: { type: String, required: true },
    gstin: { type: String, trim: true, uppercase: true },
    panNumber: { type: String, trim: true, uppercase: true },
    businessAddress: {
      address: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pinCode: { type: String, trim: true },
      country: { type: String, default: "India" },
    },
    bankDetails: {
      accountHolderName: { type: String, trim: true },
      accountNumber: { type: String, select: false },
      ifscCode: { type: String, trim: true, uppercase: true, select: false },
      bankName: { type: String, trim: true },
    },
    documents: {
      gstin: {
        url: { type: String, trim: true },
        publicId: { type: String, trim: true },
        status: {
          type: String,
          enum: ["Pending", "Approved", "Rejected"],
          default: "Pending",
        },
        rejectionReason: { type: String, trim: true },
        uploadedAt: { type: Date },
      },
      panCard: {
        url: { type: String, trim: true },
        publicId: { type: String, trim: true },
        status: {
          type: String,
          enum: ["Pending", "Approved", "Rejected"],
          default: "Pending",
        },
        rejectionReason: { type: String, trim: true },
        uploadedAt: { type: Date },
      },
      nurseryLicense: {
        url: { type: String, trim: true },
        publicId: { type: String, trim: true },
        status: {
          type: String,
          enum: ["Pending", "Approved", "Rejected"],
          default: "Pending",
        },
        rejectionReason: { type: String, trim: true },
        uploadedAt: { type: Date },
      },
      identityProof: {
        url: { type: String, trim: true },
        publicId: { type: String, trim: true },
        status: {
          type: String,
          enum: ["Pending", "Approved", "Rejected"],
          default: "Pending",
        },
        rejectionReason: { type: String, trim: true },
        uploadedAt: { type: Date },
      },
      bankDetails: {
        url: { type: String, trim: true },
        publicId: { type: String, trim: true },
        status: {
          type: String,
          enum: ["Pending", "Approved", "Rejected"],
          default: "Pending",
        },
        rejectionReason: { type: String, trim: true },
        uploadedAt: { type: Date },
      },
    },
    verificationStatus: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },
    adminReviewNotes: {
      type: String,
      trim: true,
    },
    documentsSubmittedAt: {
      type: Date,
    },
    approvalStatus: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    deliveryPincodes: {
      type: [String],
      default: [],
    },
    rejectionReason: { type: String },
    commissionOverrides: [
      {
        category: { type: String, required: true, trim: true },
        customCommissionPercentage: { type: Number, required: true, min: 0, max: 100 },
      },
    ],
    defaultNurseryCommission: {
      type: Number,
      min: 0,
      max: 100,
    },
  },
  { timestamps: true }
);

nurseryProfileSchema.pre<INurseryProfile>("save", async function () {
  if (this.isModified("businessName") || !this.slug) {
    const baseSlug = slugify(this.businessName || "nursery", {
      lower: true,
      strict: true,
    });
    this.slug = baseSlug;
  }
});

nurseryProfileSchema.index({ nursery: 1 });
nurseryProfileSchema.index({ isActive: 1, approvalStatus: 1 });
nurseryProfileSchema.index({ deliveryPincodes: 1, approvalStatus: 1, isActive: 1 });
nurseryProfileSchema.index({ deliveryPincodes: 1 });
nurseryProfileSchema.index({ approvalStatus: 1 });
nurseryProfileSchema.index({ verificationStatus: 1 });
nurseryProfileSchema.index({ slug: 1 });

export default mongoose.model<INurseryProfile>("NurseryProfile", nurseryProfileSchema);