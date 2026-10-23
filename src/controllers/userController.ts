import { Request, Response, NextFunction } from "express";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import User from "../models/userModel";
import BlacklistedToken from "../models/blacklistedTokenModel";
import sendToken from "../utils/jwtToken";
import { getClearCookieOptions } from "../utils/cookieHelper";
import sendEmail, { getEmailConfig } from "../utils/sendEmail";
import { sendWelcomeEmail } from "../utils/orderEmailService";
import {
  sendContactInquiryEmails,
  getAdminNewUserAlertHtml,
  sendPasswordChangedAlert,
  sendForgotPasswordEmail,
} from "../templates/emails";
import * as crypto from "crypto";
import cloudinary from "cloudinary";
import { hashToken } from "../utils/security";
import { authenticateSocialUser } from "../services/authService";
import validator from "validator";

// ======================================================================
// REGISTER USER
// ======================================================================
export const registerUser = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { name, email, password } = req.body;

    if (
      !name ||
      !email ||
      !password ||
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return next(new ErrorHandler("Missing or invalid required fields", 400));
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!validator.isEmail(cleanEmail)) {
      return next(new ErrorHandler("Please provide a valid email address", 400));
    }

    const exists = await User.findOne({ email: cleanEmail });
    if (exists) {
      return next(new ErrorHandler("User already exists with this email", 400));
    }

    const user = await User.create({
      name: name.trim(),
      email: cleanEmail,
      password,
      role: "user",
    });

    sendWelcomeEmail(user.name, user.email).catch((e) => console.error(e));

    // Alert Super Admin about new user registration
    const config = getEmailConfig();
    const adminEmail = config.adminEmail;
    const brandName = process.env.APP_NAME || "Urban Nursery";
    if (adminEmail) {
      sendEmail({
        email: adminEmail,
        subject: `👤 [New Customer] ${user.name} registered on ${brandName}`,
        message: `New customer registered: ${user.name} (${user.email})`,
        html: getAdminNewUserAlertHtml("Customer", user.name, user.email),
        type: "ADMIN_NEW_CUSTOMER_ALERT",
      }).catch((e) => console.error("Non-fatal admin registration alert error:", e));
    }

    sendToken(user, 201, res, req);
  }
);

// ======================================================================
// NORMAL LOGIN
// ======================================================================
export const loginUser = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;

    if (
      !email ||
      !password ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return next(new ErrorHandler("Email and password required", 400));
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!validator.isEmail(cleanEmail)) {
      return next(new ErrorHandler("Invalid credentials", 401));
    }

    const user = await User.findOne({ email: cleanEmail }).select("+password");
    if (!user) return next(new ErrorHandler("Invalid credentials", 401));

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return next(new ErrorHandler("Invalid credentials", 401));

    sendToken(user, 200, res, req);
  }
);

// ======================================================================
// NURSERY DASHBOARD LOGIN
// ======================================================================
export const nurseryDashboardLogin = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, dashboardPassword } = req.body;

    if (
      !email ||
      !dashboardPassword ||
      typeof email !== "string" ||
      typeof dashboardPassword !== "string"
    ) {
      return next(new ErrorHandler("Email & dashboard password required", 400));
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!validator.isEmail(cleanEmail)) {
      return next(new ErrorHandler("Invalid dashboard password", 401));
    }

    const user = await User.findOne({ email: cleanEmail }).select("+dashboardPassword +role");

    if (!user || user.role !== "nursery" || !user.dashboardPassword)
      return next(new ErrorHandler("Not authorized for nursery dashboard", 401));

    const isMatch = await user.compareDashboardPassword(dashboardPassword);
    if (!isMatch) return next(new ErrorHandler("Invalid dashboard password", 401));

    sendToken(user, 200, res, req);
  }
);

// ======================================================================
// ADMIN DASHBOARD LOGIN 
// ======================================================================
export const adminDashboardLogin = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, dashboardPassword } = req.body;

    if (
      !email ||
      !dashboardPassword ||
      typeof email !== "string" ||
      typeof dashboardPassword !== "string"
    ) {
      return next(new ErrorHandler("Email & dashboard password required", 400));
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!validator.isEmail(cleanEmail)) {
      return next(new ErrorHandler("Invalid dashboard password", 401));
    }

    const user = await User.findOne({ email: cleanEmail }).select("+dashboardPassword +role");

    if (!user || user.role !== "admin" || !user.dashboardPassword)
      return next(new ErrorHandler("Not authorized for admin dashboard", 401));

    const isMatch = await user.compareDashboardPassword(dashboardPassword);
    if (!isMatch) return next(new ErrorHandler("Invalid dashboard password", 401));

    sendToken(user, 200, res, req);
  }
);

// ======================================================================
// LOGOUT (COMMON WITH ACTIVE REVOCATION BLOCKLIST)
// ======================================================================
export const logoutUser = catchAsyncErrors(async (req: Request, res: Response) => {
  const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];

  if (token) {
    await BlacklistedToken.create({ tokenHash: hashToken(token) }).catch((err) =>
      console.error("Token logging blocklist failure bypassed:", err)
    );
  }

  const tokenClearOptions = getClearCookieOptions(req, { httpOnly: true });
  const roleClearOptions = getClearCookieOptions(req, { httpOnly: false });

  res.clearCookie("token", tokenClearOptions);
  res.clearCookie("role", roleClearOptions);

  res.status(200).json({
    success: true,
    message: "Logged out successfully and session blacklisted.",
  });
});

export const logoutNursery = logoutUser;
export const logoutAdmin = logoutUser;

// ======================================================================
// FORGOT PASSWORD
// ======================================================================
export const forgotPassword = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawEmail = req.body?.email;

    if (!rawEmail || typeof rawEmail !== "string") {
      return next(new ErrorHandler("Please provide an email address", 400));
    }

    const email = rawEmail.trim().toLowerCase();
    if (!validator.isEmail(email)) {
      return next(new ErrorHandler("Please provide a valid email address", 400));
    }

    const user = await User.findOne({ email });

    // Security: always return 200 for non-existent emails (prevents email enumeration)
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If an account exists with this email, a reset link has been dispatched.",
      });
    }

    // Generate raw token (unhashed), store hashed in DB with 15-min expiry
    const resetToken = user.getResetPasswordToken();
    await user.save({ validateBeforeSave: false });

    // Build reset URL matching frontend route: /password/reset/[token]
    const frontendUrl = process.env.FRONTEND_URL?.trim().replace(/\/+$/, "") || "http://localhost:3000";
    const resetPasswordUrl = `${frontendUrl}/password/reset/${resetToken}`;

    console.log(`🔑 [ForgotPassword] Generated reset URL for ${user.email}: ${resetPasswordUrl} (Valid 15 min)`);

    // Dispatch email — sendForgotPasswordEmail returns EmailResult (never throws)
    const result = await sendForgotPasswordEmail(user.email, user.name, resetPasswordUrl);

    if (!result.success) {
      // Email delivery failed: clear the token so user isn't stuck with a phantom token
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });

      console.error(`❌ [Email Trigger Failed] Event: ForgotPassword, Recipient: ${user.email}, Error: ${result.error}`);
      return next(
        new ErrorHandler(
          "Email delivery failed. Please check your email address or try again later.",
          500
        )
      );
    }

    console.log(`✅ [ForgotPassword] Reset email delivered to ${user.email} | Token valid 15 min`);

    res.status(200).json({
      success: true,
      message: "If an account exists with this email, a reset link has been dispatched.",
    });
  }
);

// ======================================================================
// RESET PASSWORD
// ======================================================================
export const resetPassword = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { password, confirmPassword } = req.body;
    const token = req.params.token as string;

    if (!token) return next(new ErrorHandler("Reset token is required", 400));
    if (!password || !confirmPassword) return next(new ErrorHandler("All fields are required", 400));
    if (password.length < 8) return next(new ErrorHandler("Password must be at least 8 characters long", 400));
    if (password !== confirmPassword) return next(new ErrorHandler("Passwords do not match", 400));

    const resetPasswordToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: new Date() },
    });

    if (!user) return next(new ErrorHandler("Reset password token is invalid or expired", 400));

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    // 📧 Non-blocking: Notify user that password was reset
    sendPasswordChangedAlert(user.email, user.name).catch((err) =>
      console.error("❌ [Email Trigger Failed] Event: PasswordReset-Changed, Error:", err?.message)
    );

    sendToken(user, 200, res);
  }
);

// ======================================================================
// GET USER DETAILS
// ======================================================================
export const getUserDetails = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ErrorHandler("Unauthorized", 401));

    const user = await User.findById((req.user as any)._id).lean();
    if (!user) return next(new ErrorHandler("User not found", 404));

    res.status(200).json({
      success: true,
      user,
    });
  }
);

// ======================================================================
// UPDATE PASSWORD
// ======================================================================
export const updatePassword = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ErrorHandler("Unauthorized", 401));

    const user = await User.findById((req.user as any)._id).select("+password");
    if (!user) return next(new ErrorHandler("User not found", 404));

    const isMatched = await user.comparePassword(req.body.oldPassword);
    if (!isMatched) return next(new ErrorHandler("Old password is incorrect", 400));

    if (req.body.newPassword !== req.body.confirmPassword)
      return next(new ErrorHandler("Passwords do not match", 400));

    user.password = req.body.newPassword;
    await user.save();

    // 📧 Non-blocking: Notify user that password was updated
    sendPasswordChangedAlert(user.email, user.name).catch((err) =>
      console.error("❌ [Email Trigger Failed] Event: PasswordUpdate-Changed, Error:", err?.message)
    );

    sendToken(user, 200, res);
  }
);

// ======================================================================
// UPDATE PROFILE
// ======================================================================
export const updateProfile = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ErrorHandler("Unauthorized", 401));

    const newUserData: any = {
      name: req.body.name,
      email: req.body.email?.toLowerCase(),
    };

    const userId = (req.user as any)._id;

    if (req.body.avatar && req.body.avatar !== "") {
      const user = await User.findById(userId);

      if (user?.avatar?.public_id && user.avatar.public_id !== "avatars/default_id") {
        await cloudinary.v2.uploader.destroy(user.avatar.public_id);
      }

      const myCloud = await cloudinary.v2.uploader.upload(req.body.avatar, {
        folder: "avatars",
        width: 150,
        crop: "scale",
      });

      newUserData.avatar = {
        public_id: myCloud.public_id,
        url: myCloud.secure_url,
      };
    }

    const user = await User.findByIdAndUpdate(userId, newUserData, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user,
    });
  }
);

// ======================================================================
// ADMIN — GET ALL USERS
// ======================================================================
export const getAllUsers = catchAsyncErrors(async (req: Request, res: Response) => {
  const page = Number(req.query.page) || 1;
  const rawLimit = Number(req.query.limit) || 20;
  const limit = Math.min(Math.max(rawLimit, 1), 100);
  const skip = (page - 1) * limit;

  // ⚡ PERF: Parallel query execution with .lean()
  const [totalUsersCount, users] = await Promise.all([
    User.countDocuments(),
    User.find()
      .select("-password -dashboardPassword")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  res.status(200).json({
    success: true,
    totalUsersCount,
    page,
    limit,
    users,
  });
});

// ======================================================================
// ADMIN — GET SINGLE USER
// ======================================================================
export const getSingleUser = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = await User.findById(req.params.id)
      .select("-password -dashboardPassword")
      .lean();
    if (!user) return next(new ErrorHandler(`User not found with ID: ${req.params.id}`, 404));

    res.status(200).json({ success: true, user });
  }
);

// ======================================================================
// ADMIN — UPDATE USER ROLE
// ======================================================================
export const updateUserRole = catchAsyncErrors(async (req: Request, res: Response, next: NextFunction) => {
  const newUserData = {
    name: req.body.name,
    email: req.body.email?.toLowerCase(),
    role: req.body.role,
  };

  const user = await User.findByIdAndUpdate(req.params.id, newUserData, {
    new: true,
    runValidators: true,
  }).select("-password -dashboardPassword");

  if (!user) {
    return next(new ErrorHandler(`User entity processing context missing for ID: ${req.params.id}`, 404));
  }

  res.status(200).json({ success: true, message: "User role updated successfully", user });
});

// ======================================================================
// ADMIN — DELETE USER
// ======================================================================
export const deleteUser = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = await User.findById(req.params.id);
    if (!user) return next(new ErrorHandler(`User not found with ID: ${req.params.id}`, 404));

    if (user.avatar?.public_id && user.avatar.public_id !== "avatars/default_id") {
      await cloudinary.v2.uploader.destroy(user.avatar.public_id);
    }

    await user.deleteOne();
    res.status(200).json({ success: true, message: "User deleted successfully" });
  }
);

// ======================================================================
// ADMIN — GET ALL NURSERY USERS + STATS (⚡ OPTIMIZED PIPELINE)
// ======================================================================
export const getAllNurseryUsers = catchAsyncErrors(async (req: Request, res: Response) => {
  const nurseriesWithStats = await User.aggregate([
    { $match: { role: "nursery" } },
    {
      $project: {
        name: 1,
        email: 1,
        role: 1,
        avatar: 1,
        createdAt: 1,
      },
    },
    {
      $lookup: {
        from: "plants",
        localField: "_id",
        foreignField: "nursery",
        as: "plantsData",
      },
    },
    {
      $lookup: {
        from: "orders",
        let: { nurseryId: "$_id" },
        pipeline: [
          { $match: { $expr: { $in: ["$$nurseryId", "$orderItems.nursery"] } } },
          { $project: { orderItems: 1 } }
        ],
        as: "ordersData",
      },
    },
    {
      $addFields: {
        plantCount: { $size: "$plantsData" },
        orderCount: { $size: "$ordersData" },
        totalSales: {
          $reduce: {
            input: "$ordersData",
            initialValue: 0,
            in: {
              $add: [
                "$$value",
                {
                  $sum: {
                    $map: {
                      input: {
                        $filter: {
                          input: "$$this.orderItems",
                          as: "item",
                          cond: { $eq: ["$$item.nursery", "$_id"] },
                        },
                      },
                      as: "filteredItem",
                      in: { $multiply: ["$$filteredItem.price", "$$filteredItem.quantity"] },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
    { $unset: ["plantsData", "ordersData"] },
    { $sort: { createdAt: -1 } }
  ]);

  res.status(200).json({
    success: true,
    count: nurseriesWithStats.length,
    users: nurseriesWithStats,
  });
});

// ======================================================================
// GOOGLE AUTHENTICATION / SOCIAL LOGIN
// ======================================================================
export const socialLogin = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { provider, token, role } = req.body;

    if (!token) {
      return next(new ErrorHandler("Token is required for Google authentication", 400));
    }

    if (provider && provider !== "google") {
      return next(
        new ErrorHandler("Invalid provider. Supported provider is 'google'", 400)
      );
    }

    const user = await authenticateSocialUser("google", token, role);

    sendToken(user, 200, res, req);
  }
);

// ======================================================================
// 💬 SUBMIT CONTACT INQUIRY
// ======================================================================
export const submitContactInquiry = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !message) {
      return next(new ErrorHandler("Please provide name, email, and message", 400));
    }

    if (!validator.isEmail(email)) {
      return next(new ErrorHandler("Please provide a valid email address", 400));
    }

    const cleanSubject = subject?.trim() || "General Plant Inquiry";

    // Non-blocking trigger: sends confirmation to customer + alert to admin
    sendContactInquiryEmails(name.trim(), email.trim().toLowerCase(), cleanSubject, message.trim()).catch((err) =>
      console.error("Non-fatal contact inquiry email error:", err)
    );

    res.status(200).json({
      success: true,
      message: "Thank you for reaching out! We have received your inquiry and our team will get back to you within 24 hours.",
    });
  }
);