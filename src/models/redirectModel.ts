import mongoose, { Schema, Document, Model } from "mongoose";

export interface IRedirect extends Document {
  oldSlug: string;
  newSlug: string;
  entityType: string;
  entityId: mongoose.Types.ObjectId;
  statusCode: number;
  hits: number;
  lastAccessedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const redirectSchema = new Schema<IRedirect>(
  {
    oldSlug: {
      type: String,
      required: [true, "Old slug is required for redirect mapping"],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    newSlug: {
      type: String,
      required: [true, "New destination slug is required"],
      lowercase: true,
      trim: true,
      index: true,
    },
    entityType: {
      type: String,
      required: [true, "Entity type (e.g. Plant, Pot, Blog) is required"],
      trim: true,
      index: true,
    },
    entityId: {
      type: Schema.Types.ObjectId,
      required: [true, "Associated entity ID is required"],
      index: true,
    },
    statusCode: {
      type: Number,
      default: 301,
      enum: [301, 302, 307, 308],
    },
    hits: {
      type: Number,
      default: 0,
    },
    lastAccessedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for fast entity lookups
redirectSchema.index({ entityType: 1, oldSlug: 1 });
redirectSchema.index({ entityId: 1, entityType: 1 });

export const Redirect: Model<IRedirect> =
  mongoose.models.Redirect || mongoose.model<IRedirect>("Redirect", redirectSchema);

export default Redirect;
