import express from "express";
import productRoutes from "./productRoute";
import userRoutes from "./userRoutes";
import orderRouter from "./ordersRoute";
import nurseryProfileRoutes from "./nurseryProfileRoute";
import nurseryRoutes from "./nurseryRoute";
import adminRoutes from "./adminRoute";
import paymentRoutes from "./paymentRoute";
import blogRoutes from "./blogRoute";
import newsletterRoutes from "./newsletterRoute";
import cartWishlistRouter, { cartRouter, wishlistRouter } from "./cartWishlistRoutes";
import dashboardRoutes from "./dashboardRoutes";
import couponRoutes from "./couponRoute";
import bulkOrderRoutes from "./bulkOrderRoute";
import payoutRoutes from "./payoutRoute";
import authRoutes from "./authRoute";
import taxRoutes from "./taxRoute";
import commissionRoutes from "./commissionRoute";
import claimRoutes from "./claimRoutes";
import reviewRoutes, { adminReviewRouter } from "./reviewRoute";

const mainRouter = express.Router();

// 🔐 Authentication system routes (Social OAuth + Credentials)
mainRouter.use("/auth", authRoutes);

// ======================================================================
// 🚀 PLUGGING ALL CORE PRODUCTION ENDPOINTS
// ======================================================================

// 🛍️ Unified Polymorphic Product Catalog routes
mainRouter.use("/products", productRoutes);
mainRouter.use("/product", productRoutes);

// 👤 Customer & identity system routes (Auth/Profile)
mainRouter.use("/users", userRoutes);
mainRouter.use("/user", userRoutes);

// 🛒 Orders, multi-vendor splits & tracking routes
mainRouter.use("/orders", orderRouter);

// 🔄 Unified Return, Replacement & Damage Claims Engine (Customer Claims, Nursery & Admin Workflow)
mainRouter.use("/claims", claimRoutes);
mainRouter.use("/claim", claimRoutes);
mainRouter.use("/returns", claimRoutes);
mainRouter.use("/return-replacement", claimRoutes);

// 🏡 Nursery Onboarding Applications & Vendor verification records
mainRouter.use("/nursery-profile", nurseryProfileRoutes);
mainRouter.use("/nursery", nurseryRoutes);
mainRouter.use("/vendors", nurseryProfileRoutes);

// 🛡️ Admin Verification & Management Engine
mainRouter.use("/admin/reviews", adminReviewRouter);
mainRouter.use("/reviews", reviewRoutes);
mainRouter.use("/admin", adminRoutes);

// 💳 Razorpay Payments Gateway & Webhook Security handling
mainRouter.use("/payment", paymentRoutes);

// 📖 Content, Organic SEO growth & Traffic generation engine
mainRouter.use("/blogs", blogRoutes);
mainRouter.use("/blog", blogRoutes);
mainRouter.use("/marketing", blogRoutes);

// 📧 Newsletter subscription management & admin dashboard access
mainRouter.use("/newsletter", newsletterRoutes);

// 🛒 E-Commerce Cart & Wishlist Gateway Routes (/shop/cart, /shop/wishlist + legacy aliases)
mainRouter.use("/shop/cart", cartRouter);
mainRouter.use("/shop/wishlist", wishlistRouter);
mainRouter.use("/shop", cartWishlistRouter);
mainRouter.use("/cart", cartRouter);
mainRouter.use("/wishlist", wishlistRouter);

// 📊 Dashboard metrics, analytics, inventory charts & financial reports (/dashboard + /admin-dashboard aliases)
mainRouter.use("/dashboard", dashboardRoutes);
mainRouter.use("/admin-dashboard", dashboardRoutes);

// 🎟️ Coupons, discount vouchers and automated promotional codes (/promotions/coupon, /promotions/coupons + legacy aliases)
mainRouter.use("/promotions/coupon", couponRoutes);
mainRouter.use("/promotions/coupons", couponRoutes);
mainRouter.use("/promotions", couponRoutes);
mainRouter.use("/coupons", couponRoutes);
mainRouter.use("/coupon", couponRoutes);

// 📦 Bulk orders corporate inquiries and nursery wholesale quotes
mainRouter.use("/bulk-order", bulkOrderRoutes);
mainRouter.use("/bulk-orders", bulkOrderRoutes);

// 💸 Direct Bank Payouts, Merchant settlements and financial reconciliation
mainRouter.use("/payouts", payoutRoutes);
mainRouter.use("/payout", payoutRoutes);

// ⚖️ Platform dynamic commission rate configurations and nursery tiering
mainRouter.use("/commissions", commissionRoutes);
mainRouter.use("/commission", commissionRoutes);

// 🏛️ Dynamic GST tax percentages and product HSN codes engine
mainRouter.use("/taxes", taxRoutes);
mainRouter.use("/tax", taxRoutes);

export default mainRouter;
