import mongoose, { Schema } from "mongoose";
import validator from "validator";
import { INewsletterDocument } from "../types/newsletter.types";

const newsletterSchema = new Schema<INewsletterDocument>(
  {
    email: {
      type: String,
      required: [true, "Email address is required"],
      unique: true,
      trim: true,
      lowercase: true,
      validate: [validator.isEmail, "Please provide a valid email address"],
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "unsubscribed"],
      default: "active",
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    subscribedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Keep status and isActive synchronized
newsletterSchema.pre("save", function (this: any) {
  if (this.isModified("status")) {
    this.isActive = this.status === "active";
  } else if (this.isModified("isActive")) {
    this.status = this.isActive ? "active" : "unsubscribed";
  }
});

export const Newsletter =
  mongoose.models.Newsletter ||
  mongoose.model<INewsletterDocument>("Newsletter", newsletterSchema);

export default Newsletter;