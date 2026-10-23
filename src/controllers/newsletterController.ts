import { Request, Response, NextFunction } from "express";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import Newsletter from "../models/newsletterModel";
import validator from "validator";
import * as crypto from "node:crypto";
import {
  sendNewsletterWelcomeEmail,
  sendAdminNewSubscriberAlert,
} from "../templates/emails";

// Helper to generate a tamper-proof unsubscribe token for an email
export const generateUnsubscribeToken = (email: string): string => {
  const secret = process.env.JWT_SECRET || "urban_nursery_secure_newsletter_token_salt";
  return crypto
    .createHmac("sha256", secret)
    .update(email.trim().toLowerCase())
    .digest("hex");
};

// ======================================================================
// 📥 1. SUBSCRIBE TO NEWSLETTER (Public Form)
// ======================================================================
export const subscribeNewsletter = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawEmail = req.body?.email;

    if (!rawEmail || typeof rawEmail !== "string") {
      return next(new ErrorHandler("Please provide an email address", 400));
    }

    const email = rawEmail.trim().toLowerCase();

    if (!validator.isEmail(email)) {
      return next(new ErrorHandler("Please provide a valid email address (e.g. name@example.com)", 400));
    }

    const existingSubscriber = await Newsletter.findOne({ email });

    if (existingSubscriber) {
      // If already active, return friendly 200 response without error
      if (existingSubscriber.status === "active" || existingSubscriber.isActive) {
        return res.status(200).json({
          success: true,
          alreadySubscribed: true,
          message: "You're already subscribed to our green newsletter! Check your inbox for our latest updates.",
        });
      }

      // If previously unsubscribed, reactivate
      existingSubscriber.status = "active";
      existingSubscriber.isActive = true;
      existingSubscriber.subscribedAt = new Date();
      await existingSubscriber.save();

      // Non-blocking welcome email dispatch
      sendNewsletterWelcomeEmail(email).catch((e) =>
        console.error("Failed to send welcome back email:", e)
      );

      return res.status(200).json({
        success: true,
        alreadySubscribed: false,
        message: "Welcome back! Your newsletter subscription has been reactivated.",
      });
    }

    // Create new subscriber
    await Newsletter.create({
      email,
      status: "active",
      isActive: true,
      subscribedAt: new Date(),
    });

    const totalActiveCount = await Newsletter.countDocuments({
      $or: [{ status: "active" }, { isActive: true }],
    });

    // ⚡ Trigger non-blocking transactional emails:
    // 1. Welcome email with 10% coupon code to the new subscriber
    sendNewsletterWelcomeEmail(email, "WELCOME10").catch((err) =>
      console.error("Non-fatal: Subscriber welcome email error:", err)
    );

    // 2. Alert to Super Admin about the new subscriber
    sendAdminNewSubscriberAlert(email, totalActiveCount).catch((err) =>
      console.error("Non-fatal: Admin subscriber notification error:", err)
    );

    return res.status(201).json({
      success: true,
      alreadySubscribed: false,
      message: "Thank you for subscribing! Check your inbox for a special 10% welcome coupon.",
    });
  }
);

// ======================================================================
// 📤 2. UNSUBSCRIBE FROM NEWSLETTER (One-Click or Form)
// ======================================================================
export const unsubscribeNewsletter = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawEmail = req.body?.email || req.query?.email;
    const token = (req.body?.token || req.query?.token) as string | undefined;

    if (!rawEmail || typeof rawEmail !== "string") {
      return next(new ErrorHandler("Email parameter is required to unsubscribe", 400));
    }

    const email = rawEmail.trim().toLowerCase();

    // Verify cryptographic token if present
    if (token) {
      const expectedToken = generateUnsubscribeToken(email);
      const tokenBuffer = Buffer.from(token, "utf-8");
      const expectedBuffer = Buffer.from(expectedToken, "utf-8");

      if (tokenBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(tokenBuffer, expectedBuffer)) {
        return next(new ErrorHandler("Invalid or expired unsubscribe link", 403));
      }
    }

    const subscriber = await Newsletter.findOne({ email });

    if (!subscriber) {
      return next(new ErrorHandler("This email is not subscribed to our newsletter", 404));
    }

    subscriber.status = "unsubscribed";
    subscriber.isActive = false;
    await subscriber.save();

    // If request was a GET from a browser link click, render a friendly HTML response
    if (req.method === "GET") {
      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Unsubscribed — Urban Nursery</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
            .card { background: white; max-width: 480px; width: 100%; border-radius: 16px; padding: 36px 28px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); text-align: center; border: 1px solid #e2e8f0; }
            h1 { color: #0f172a; font-size: 22px; margin: 12px 0; }
            p { font-size: 14px; color: #64748b; line-height: 1.6; }
            .btn { display: inline-block; background: #15803d; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 18px; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div style="font-size: 40px;">🌱</div>
            <h1>You have been unsubscribed</h1>
            <p><strong>${email}</strong> has been removed from our regular newsletter mailing list. You can re-subscribe anytime from our website.</p>
            <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}" class="btn">Return to Urban Nursery</a>
          </div>
        </body>
        </html>
      `);
    }

    return res.status(200).json({
      success: true,
      message: "You have been successfully unsubscribed from our mailing list.",
    });
  }
);

// ======================================================================
// 🛡️ 3. ADMIN: GET ALL SUBSCRIBERS LIST (Pagination, Search, CSV Export)
// ======================================================================
export const getAllSubscribers = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status = req.query.status as string | undefined;
    const isExport = req.query.export === "csv" || req.query.format === "csv";

    // Build filter
    const query: any = {};

    if (search) {
      query.email = { $regex: search, $options: "i" };
    }

    if (status === "active") {
      query.$or = [{ status: "active" }, { isActive: true }];
    } else if (status === "unsubscribed") {
      query.$or = [{ status: "unsubscribed" }, { isActive: false }];
    }

    // CSV Export Mode
    if (isExport) {
      const allSubscribers = await Newsletter.find(query).sort({ subscribedAt: -1 });

      let csv = "Index,Email Address,Status,Subscribed Date\n";
      allSubscribers.forEach((sub, idx) => {
        const subDate = sub.subscribedAt ? new Date(sub.subscribedAt).toISOString() : "N/A";
        const subStatus = sub.status || (sub.isActive ? "active" : "unsubscribed");
        csv += `${idx + 1},"${sub.email}",${subStatus},"${subDate}"\n`;
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=urban-nursery-subscribers-${Date.now()}.csv`);
      return res.status(200).send(csv);
    }

    // Paginated list
    const [subscribers, totalSubscribers, totalActive, totalUnsubscribed] = await Promise.all([
      Newsletter.find(query).sort({ subscribedAt: -1 }).skip(skip).limit(limit).lean(),
      Newsletter.countDocuments(query),
      Newsletter.countDocuments({ $or: [{ status: "active" }, { isActive: true }] }),
      Newsletter.countDocuments({ $or: [{ status: "unsubscribed" }, { isActive: false }] }),
    ]);

    // Format output
    const formattedSubscribers = subscribers.map((sub: any) => ({
      _id: sub._id,
      email: sub.email,
      status: sub.status || (sub.isActive ? "active" : "unsubscribed"),
      isActive: sub.isActive ?? (sub.status === "active"),
      subscribedAt: sub.subscribedAt || sub.createdAt || new Date(),
    }));

    return res.status(200).json({
      success: true,
      count: formattedSubscribers.length,
      totalSubscribers,
      activeSubscribers: totalActive,
      unsubscribedSubscribers: totalUnsubscribed,
      currentPage: page,
      totalPages: Math.ceil(totalSubscribers / limit) || 1,
      subscribers: formattedSubscribers,
    });
  }
);

// ======================================================================
// 🛡️ 4. ADMIN: DELETE SUBSCRIBER
// ======================================================================
export const deleteSubscriber = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const subscriber = await Newsletter.findById(id);
    if (!subscriber) {
      return next(new ErrorHandler("Subscriber not found", 404));
    }

    await Newsletter.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Subscriber removed successfully",
    });
  }
);

// ======================================================================
// 🛡️ 5. ADMIN: TOGGLE SUBSCRIBER STATUS
// ======================================================================
export const toggleSubscriberStatus = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const requestedStatus = req.body?.status;

    const subscriber = await Newsletter.findById(id);
    if (!subscriber) {
      return next(new ErrorHandler("Subscriber not found", 404));
    }

    if (requestedStatus && ["active", "unsubscribed"].includes(requestedStatus)) {
      subscriber.status = requestedStatus;
      subscriber.isActive = requestedStatus === "active";
    } else {
      const nextStatus = subscriber.status === "active" ? "unsubscribed" : "active";
      subscriber.status = nextStatus;
      subscriber.isActive = nextStatus === "active";
    }

    await subscriber.save();

    return res.status(200).json({
      success: true,
      message: `Subscriber marked as ${subscriber.status}`,
      subscriber: {
        _id: subscriber._id,
        email: subscriber.email,
        status: subscriber.status,
        isActive: subscriber.isActive,
        subscribedAt: subscriber.subscribedAt,
      },
    });
  }
);