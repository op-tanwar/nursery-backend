import { Document, Types } from "mongoose";

// ======================================================================
// 1️⃣ Avatar Structure Interface
// ======================================================================
interface IUserAvatar {
  public_id: string;
  url: string;
}

// ======================================================================
// 2️⃣ Main User Interface (Extending Mongoose Document)
// ======================================================================
export interface IUser extends Document {
  _id: Types.ObjectId; // Safe typing for MongoDB HexString ObjectIds
  name: string;
  email: string;
  password?: string; // Optional for OAuth-created users and excluded on queries
  dashboardPassword?: string; // Optional for safety
  role: "user" | "nursery" | "admin"; // Strictly typed roles
  avatar: IUserAvatar;
  googleId?: string;
  authProvider?: "local" | "google" | "email";
  resetPasswordToken?: string;
  resetPasswordExpire?: Date;
  createdAt: Date;
  isActive: boolean;
  isBlocked: boolean;
  status: "Active" | "Suspended" | "Blocked";
  updatedAt: Date;

  // Mongoose Schema Methods Definitions
  comparePassword(pwd: string): Promise<boolean>;
  compareDashboardPassword(pwd: string): Promise<boolean>;
  getJwtToken(): string;
  getResetPasswordToken(): string;
}
