import mongoose, { Schema } from "mongoose";
import validator from "validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import * as crypto from "crypto";
import { IUser } from "../types/user.types";

export { IUser };

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, "Please enter your name"],
      minlength: [4, "Name must be at least 4 characters"],
      maxlength: [30, "Name cannot exceed 30 characters"]
    },
    email: {
      type: String,
      required: [true, "Please enter your email"],
      unique: true,
      lowercase: true,
      validate: [validator.isEmail, "Invalid email format"],
    },
    password: {
      type: String,
      required: function (this: any) {
        return !this.googleId && (!this.authProvider || this.authProvider === "local" || this.authProvider === "email");
      },
      minlength: [8, "Password must be at least 8 characters"],
      select: false
    },
    googleId: {
      type: String,
      default: null,
      sparse: true,
      index: true,
    },
    authProvider: {
      type: String,
      enum: ["local", "google", "email"],
      default: "local",
    },
    dashboardPassword: {
      type: String,
      select: false
    },
    role: {
      type: String,
      enum: ["user", "nursery", "admin"],
      default: "user",
    },
    avatar: {
      public_id: {
        type: String,
        default: "avatars/default_id"
      },
      url: {
        type: String,
        default: "https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg"
      },
    },
    // Alignment with real-time auth parameters
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    isBlocked: {
      type: Boolean,
      default: false,
      index: true
    },
    status: {
      type: String,
      enum: ["Active", "Suspended", "Blocked"],
      default: "Active",
      index: true
    },
    resetPasswordToken: String,
    resetPasswordExpire: Date,
  },
  { timestamps: true }
);

userSchema.pre<IUser>("save", async function () {
  if (this.isModified("password") && this.password) {
    this.password = (await bcrypt.hash(this.password, 10))!;
  }

  if (this.isModified("dashboardPassword") && this.dashboardPassword) {
    this.dashboardPassword = (await bcrypt.hash(this.dashboardPassword, 10))!;
  }
});

userSchema.methods.comparePassword = async function (pwd: string): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(pwd, this.password);
};

userSchema.methods.compareDashboardPassword = async function (pwd: string): Promise<boolean> {
  if (!this.dashboardPassword) return false;
  return bcrypt.compare(pwd, this.dashboardPassword);
};

userSchema.methods.getJwtToken = function (): string {
  return jwt.sign({ id: this._id, role: this.role }, process.env.JWT_SECRET!, {
    expiresIn: (process.env.JWT_EXPIRES_TIME || "7d") as any,
  });
};

userSchema.methods.getResetPasswordToken = function (): string {
  const resetToken = crypto.randomBytes(20).toString("hex");

  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  this.resetPasswordExpire = new Date(Date.now() + 15 * 60 * 1000);

  return resetToken;
};

export default mongoose.model<IUser>("User", userSchema);
