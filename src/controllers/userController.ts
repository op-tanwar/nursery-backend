import { Request, Response, NextFunction } from "express";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import User from "../models/userModel";
import BlacklistedToken from "../models/blacklistedTokenModel";
import sendToken from "../utils/jwtToken";
import { getClearCookieOptions } from "../utils/cookieHelper";
import sendEmail, { getEmailConfig } from "../utils/sendEmail";
import {
  sendWelcomeEmail,
  sendForgotPasswordEmail,
  sendPasswordResetEmail,
  sendPasswordChangedAlert,
  sendAdminNewVendorAlert,
} from "../utils/orderEmailService";
import {
  sendContactInquiryEmails,
  getAdminNewUserAlertHtml,
  sendEmailChangeOtpEmail,
  sendEmailChangedSuccessNotification,
} from "../templates/emails";
import * as crypto from "crypto";
import cloudinary from "cloudinary";
import { hashToken } from "../utils/security";
import { authenticateSocialUser } from "../services/authService";
import validator from "validator";
import NurseryProfile from "../models/nurseryProfileModel";
import {
  assertAccountActive,
  assertNurseryProfileActive,
  AppError,
} from "../utils/authGuard";

export { assertAccountActive, assertNurseryProfileActive, AppError };

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

    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 70) {
      return next(new ErrorHandler("Name must be between 2 and 70 characters", 400));
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
      name: cleanName,
      email: cleanEmail,
      password,
      role: "user",
    });

    sendWelcomeEmail({ email: user.email, name: user.name }).catch((e) =>
      console.error("❌ [Email Trigger Failed] Event: WelcomeEmail, Error:", e?.message || e)
    );

    if (user.role === "nursery") {
      sendAdminNewVendorAlert(user).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: AdminNewVendorAlert, Error:", e?.message || e)
      );
    }

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
      }).catch((e) =>
        console.error("❌ [Email Trigger Failed] Event: AdminRegistrationAlert, Error:", e?.message || e)
      );
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

    const user = await User.findOne({ email: cleanEmail }).select(
      "+password +isActive +isBlocked +status"
    );
    if (!user) return next(new ErrorHandler("Invalid credentials", 401));

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return next(new ErrorHandler("Invalid credentials", 401));

    // 🔒 SECURITY GUARD: Assert user account is active before token issuance
    assertAccountActive(user);

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

    const user = await User.findOne({ email: cleanEmail }).select(
      "+dashboardPassword +role +isActive +isBlocked +status"
    );

    if (!user || user.role !== "nursery" || !user.dashboardPassword)
      return next(new ErrorHandler("Not authorized for nursery dashboard", 401));

    const isMatch = await user.compareDashboardPassword(dashboardPassword);
    if (!isMatch) return next(new ErrorHandler("Invalid dashboard password", 401));

    // 🔒 SECURITY GUARD 1: Assert user account is active
    assertAccountActive(user);

    // 🔒 SECURITY GUARD 2: Assert linked NurseryProfile status is valid and approved
    const profile = await NurseryProfile.findOne({ nursery: user._id });
    if (profile) {
      assertNurseryProfileActive(profile);
    }

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

    const user = await User.findOne({ email: cleanEmail }).select(
      "+dashboardPassword +role +isActive +isBlocked +status"
    );

    if (!user || user.role !== "admin" || !user.dashboardPassword)
      return next(new ErrorHandler("Not authorized for admin dashboard", 401));

    const isMatch = await user.compareDashboardPassword(dashboardPassword);
    if (!isMatch) return next(new ErrorHandler("Invalid dashboard password", 401));

    // 🔒 SECURITY GUARD: Assert admin account is active before token issuance
    assertAccountActive(user);

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
    try {
      const result = await sendForgotPasswordEmail(user.email, user.name, resetPasswordUrl);

      if (!result.success) {
        // Email delivery failed: clear the token so user isn't stuck with a phantom token
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        await user.save({ validateBeforeSave: false });

        console.error("❌ Full Nodemailer Error in forgotPassword:", {
          message: result.error,
          code: result.code,
          response: result.response,
          command: result.command,
        });

        return next(
          new ErrorHandler(
            "Email delivery failed. Please check your email address or try again later.",
            500
          )
        );
      }
    } catch (err: any) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });

      console.error("❌ Full Nodemailer Error in forgotPassword:", {
        message: err.message,
        code: err.code,
        response: err.response,
        command: err.command,
      });

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
    }).select("+isActive +isBlocked +status");

    if (!user) return next(new ErrorHandler("Reset password token is invalid or expired", 400));

    // 🔒 SECURITY GUARD: Assert user account is active before updating password & issuing token
    assertAccountActive(user);

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
// UPDATE PROFILE (WITH VERIFIED EMAIL CHANGE WORKFLOW)
// ======================================================================
export const updateProfile = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ErrorHandler("Unauthorized", 401));

    const userId = (req.user as any)._id;
    const user = await User.findById(userId).select("+emailVerificationOTP");
    if (!user) {
      return next(new ErrorHandler("User account not found", 404));
    }

    // 1. Update Safe Profile Fields (Name)
    if (req.body.name && typeof req.body.name === "string") {
      const cleanName = req.body.name.trim();
      if (cleanName.length < 2 || cleanName.length > 70) {
        return next(
          new ErrorHandler("Name must be between 2 and 70 characters", 400)
        );
      }
      user.name = cleanName;
    }

    // 2. Update Avatar if provided
    if (req.body.avatar && req.body.avatar !== "") {
      if (user.avatar?.public_id && user.avatar.public_id !== "avatars/default_id") {
        await cloudinary.v2.uploader.destroy(user.avatar.public_id);
      }

      const myCloud = await cloudinary.v2.uploader.upload(req.body.avatar, {
        folder: "avatars",
        width: 150,
        crop: "scale",
      });

      user.avatar = {
        public_id: myCloud.public_id,
        url: myCloud.secure_url,
      };
    }

    // 3. Email Change Handling (Requires Verification)
    let requiresEmailVerification = false;
    let pendingEmailAddress: string | null = null;

    if (req.body.email && typeof req.body.email === "string") {
      const cleanEmail = req.body.email.trim().toLowerCase();

      // Only initiate verification if the new email differs from the current active email
      if (cleanEmail !== user.email.toLowerCase()) {
        if (!validator.isEmail(cleanEmail)) {
          return next(new ErrorHandler("Please provide a valid email address.", 400));
        }

        // Check if the new email is already claimed by another user account
        const emailConflict = await User.findOne({
          email: cleanEmail,
          _id: { $ne: user._id },
        });

        if (emailConflict) {
          return next(
            new ErrorHandler("This email address is already in use by another account.", 400)
          );
        }

        // Generate cryptographically secure 6-digit numeric OTP
        const otp = crypto.randomInt(100000, 1000000).toString();
        const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes TTL

        user.pendingEmail = cleanEmail;
        user.emailVerificationOTP = hashedOtp;
        user.emailVerificationExpires = expiresAt;

        requiresEmailVerification = true;
        pendingEmailAddress = cleanEmail;

        // Dispatch verification email to the NEW email address asynchronously
        sendEmailChangeOtpEmail(cleanEmail, user.name, otp, 15).catch((err) => {
          console.error("❌ [Email Dispatch Failed] Email Change OTP:", err?.message || err);
        });
      }
    }

    await user.save();

    const userObj = user.toObject ? user.toObject() : user;
    delete (userObj as any).password;
    delete (userObj as any).dashboardPassword;
    delete (userObj as any).emailVerificationOTP;

    if (requiresEmailVerification) {
      return res.status(200).json({
        success: true,
        requiresEmailVerification: true,
        pendingEmail: pendingEmailAddress,
        message: `Profile updated. A 6-digit verification code has been sent to ${pendingEmailAddress}. Please verify to complete your email change.`,
        user: userObj,
      });
    }

    res.status(200).json({
      success: true,
      requiresEmailVerification: false,
      message: "Profile updated successfully.",
      user: userObj,
    });
  }
);

// ======================================================================
// VERIFY EMAIL CHANGE (PROTECTED)
// ======================================================================
export const verifyEmailChange = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ErrorHandler("Unauthorized", 401));

    const { otp } = req.body;
    if (!otp || typeof otp !== "string" || !otp.trim()) {
      return next(new ErrorHandler("Please provide the 6-digit verification code.", 400));
    }

    const cleanOtp = otp.trim();
    if (!/^\d{6}$/.test(cleanOtp)) {
      return next(new ErrorHandler("Verification code must be exactly 6 digits.", 400));
    }

    const user = await User.findById(req.user._id).select(
      "+emailVerificationOTP +pendingEmail +emailVerificationExpires"
    );

    if (!user) {
      return next(new ErrorHandler("User not found.", 404));
    }

    if (!user.pendingEmail) {
      return next(
        new ErrorHandler("No pending email change request found for this account.", 400)
      );
    }

    if (!user.emailVerificationOTP || !user.emailVerificationExpires) {
      return next(
        new ErrorHandler("Verification code is missing or has expired. Please request a new one.", 400)
      );
    }

    if (new Date() > user.emailVerificationExpires) {
      return next(
        new ErrorHandler("Verification code has expired. Please request a new code.", 400)
      );
    }

    // Cryptographic constant-time comparison
    const hashedInputOtp = crypto.createHash("sha256").update(cleanOtp).digest("hex");
    const bufferExpected = Buffer.from(user.emailVerificationOTP, "utf-8");
    const bufferReceived = Buffer.from(hashedInputOtp, "utf-8");

    if (
      bufferExpected.length !== bufferReceived.length ||
      !crypto.timingSafeEqual(bufferExpected, bufferReceived)
    ) {
      return next(new ErrorHandler("Invalid verification code. Please check and try again.", 400));
    }

    // Re-verify that the pending email was not registered by someone else during the window
    const emailConflict = await User.findOne({
      email: user.pendingEmail,
      _id: { $ne: user._id },
    });

    if (emailConflict) {
      user.pendingEmail = undefined;
      user.emailVerificationOTP = undefined;
      user.emailVerificationExpires = undefined;
      await user.save();
      return next(
        new ErrorHandler("This email address was recently registered by another account.", 409)
      );
    }

    const oldEmail = user.email;
    const newEmail = user.pendingEmail;

    // Apply the verified email
    user.email = newEmail;
    user.pendingEmail = undefined;
    user.emailVerificationOTP = undefined;
    user.emailVerificationExpires = undefined;

    await user.save();

    // Send security notification to both old and new addresses
    sendEmailChangedSuccessNotification(oldEmail, newEmail, user.name).catch((err) => {
      console.error("❌ [Email Trigger Failed] Email change alert:", err?.message || err);
    });

    const userObj = user.toObject ? user.toObject() : user;
    delete (userObj as any).password;
    delete (userObj as any).dashboardPassword;
    delete (userObj as any).emailVerificationOTP;

    res.status(200).json({
      success: true,
      message: "Email address verified and updated successfully.",
      user: userObj,
    });
  }
);

// ======================================================================
// RESEND EMAIL CHANGE OTP (PROTECTED, RATE-LIMITED COOLDOWN)
// ======================================================================
export const resendEmailChangeOtp = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ErrorHandler("Unauthorized", 401));

    const user = await User.findById(req.user._id).select(
      "+emailVerificationOTP +pendingEmail +emailVerificationExpires"
    );

    if (!user || !user.pendingEmail) {
      return next(
        new ErrorHandler("No pending email change request found for this account.", 400)
      );
    }

    // Rate-limiting cooldown: enforce 60 seconds between OTP requests
    if (user.emailVerificationExpires) {
      const msRemaining = user.emailVerificationExpires.getTime() - Date.now();
      const msElapsed = 15 * 60 * 1000 - msRemaining;
      if (msElapsed < 60 * 1000 && msElapsed >= 0) {
        const secondsToWait = Math.ceil((60 * 1000 - msElapsed) / 1000);
        return next(
          new ErrorHandler(
            `Please wait ${secondsToWait} second(s) before requesting another verification code.`,
            429
          )
        );
      }
    }

    // Re-verify that pending email is not already taken
    const emailConflict = await User.findOne({
      email: user.pendingEmail,
      _id: { $ne: user._id },
    });

    if (emailConflict) {
      return next(
        new ErrorHandler("This email address is already in use by another account.", 409)
      );
    }

    // Generate fresh OTP with 15-minute expiration
    const otp = crypto.randomInt(100000, 1000000).toString();
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    user.emailVerificationOTP = hashedOtp;
    user.emailVerificationExpires = expiresAt;
    await user.save();

    sendEmailChangeOtpEmail(user.pendingEmail, user.name, otp, 15).catch((err) => {
      console.error("❌ [Email Dispatch Failed] Resend Email Change OTP:", err?.message || err);
    });

    res.status(200).json({
      success: true,
      message: `A new 6-digit verification code has been dispatched to ${user.pendingEmail}.`,
      expiresInMinutes: 15,
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

    // 🔒 SECURITY GUARD: Assert user account is active before token issuance
    assertAccountActive(user);

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