import mongoose, { Document, Schema } from "mongoose";

export interface IBlacklistedToken extends Document {
  tokenHash: string;
  token?: string;
  createdAt: Date;
}

const blacklistedTokenSchema = new Schema<IBlacklistedToken>({
  tokenHash: {
    type: String,
    required: true,
    index: true,
  },
  // Backward compatibility for already stored entries.
  token: {
    type: String,
    select: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    // 🚀 FIXED: Retained structural native TTL index option configuration mapped securely to match system environments.
    expires: "7d",
  },
});

export default mongoose.model<IBlacklistedToken>("BlacklistedToken", blacklistedTokenSchema);