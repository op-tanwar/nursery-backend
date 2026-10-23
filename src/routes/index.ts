import express from "express";
import plantRoutes from "./plantsRoute";
import potRoutes from "./potsRoute";
import accessoryRoutes from "./accessoriesRoute";
import gardeningToolsRoutes from "./gardeningToolsRoute";
import plantCareRoutes from "./plantCareRoute";
import plantStandsShelvesRoutes from "./plantStandsShelvesRoute";
import seedsBulbsRoutes from "./seedsBulbsRoute";
import artificialDriedPlantRoutes from "./artificialDriedPlantRoute";
import userRoutes from "./userRoutes";
import orderRouter from "./ordersRoute";
import nurseryProfileRoutes from "./nurseryProfileRoute";
import nurseryRoutes from "./nurseryRoute";
import adminRoutes from "./adminRoute";
import paymentRoutes from "./paymentRoute";
import blogRoutes from "./blogRoute";
import newsletterRoutes from "./newsletterRoute";
import cartWishlistRouter from "./cartWishlistRoutes";
import dashboardRoutes from "./dashboardRoutes";
import couponRoutes from "./couponRoute";
import bulkOrderRoutes from "./bulkOrderRoute";
import payoutRoutes from "./payoutRoute";
import authRoutes from "./authRoute";
import taxRoutes from "./taxRoute";
import commissionRoutes from "./commissionRoute";
import returnRequestRoutes from "./returnRequestRoute";
import returnReplacementRoutes from "./returnReplacementRoute";

const mainRouter = express.Router();

// 🔐 Authentication system routes (Social OAuth + Credentials)
mainRouter.use("/auth", authRoutes);

// ======================================================================
// 🚀 PLUGGING ALL CORE PRODUCTION ENDPOINTS
// ======================================================================

// 🌿 Plants management & marketplace routes
mainRouter.use("/plants", plantRoutes);

// 🏺 Pots management, Planters & Terracotta marketplace routes
mainRouter.use("/pots", potRoutes);

// 🛠️ Gardening Accessories, Tools & Fertilizers inventory routes
mainRouter.use("/accessories", accessoryRoutes);

// ✂️ Gardening Tools & Equipment routes
mainRouter.use("/gardening-tools", gardeningToolsRoutes);

// 🧪 Plant Care, Soils & Fertilizers routes
mainRouter.use("/plant-care", plantCareRoutes);

// 🪜 Plant Stands & Shelves inventory routes
mainRouter.use("/plant-stands-shelves", plantStandsShelvesRoutes);

// 🌱 Seeds & Bulbs marketplace routes
mainRouter.use("/seeds-bulbs", seedsBulbsRoutes);

// 🌵 Artificial & Dried Plants marketplace routes
mainRouter.use("/artificial-dried-plants", artificialDriedPlantRoutes);

// 👤 Customer & identity system routes (Auth/Profile)
mainRouter.use("/users", userRoutes);

// 🛒 Orders, multi-vendor splits & tracking routes
mainRouter.use("/orders", orderRouter);

// 🔄 Return & Replacement Requests (Customer Claims, Nursery & Admin Workflow)
mainRouter.use("/returns", returnRequestRoutes);
mainRouter.use("/return-replacement", returnReplacementRoutes);

// 🏡 Nursery Onboarding Applications & Vendor verification records
mainRouter.use("/nursery-profile", nurseryProfileRoutes);
mainRouter.use("/nursery", nurseryRoutes);
mainRouter.use("/vendors", nurseryProfileRoutes);

// 🛡️ Admin Verification & Management Engine
mainRouter.use("/admin", adminRoutes);

// 💳 Razorpay Payments Gateway & Webhook Security handling
mainRouter.use("/payment", paymentRoutes);

// 📖 Content, Organic SEO growth & Traffic generation engine
mainRouter.use("/blogs", blogRoutes);
mainRouter.use("/blog", blogRoutes);
mainRouter.use("/marketing", blogRoutes);

// 📧 Newsletter subscription management & admin dashboard access
mainRouter.use("/newsletter", newsletterRoutes);

// 🛒 Cart and Wishlist management routes (Live Inventory Sync)
mainRouter.use("/shop", cartWishlistRouter);

// 📊 FIXED: Dashboard routing path error corrected from "/dashobard" to "/dashboard"
mainRouter.use("/dashboard", dashboardRoutes);

// 🎟️ Promotional Coupons, Discounts & Seasonal Offers Management
mainRouter.use("/promotions", couponRoutes);

// 📦 Bulk & Corporate Greenery Orders (B2B Request Engine)
mainRouter.use("/bulk-orders", bulkOrderRoutes);

// 💰 Dynamic Payout API Engine (Nursery & Admin)
mainRouter.use("/payouts", payoutRoutes);

// 🏷️ Category-wise Dynamic Tax (GST) Management Engine
mainRouter.use("/taxes", taxRoutes);
mainRouter.use("/admin/taxes", taxRoutes);

// 🪙 Category-wise Dynamic Commission Management Engine
mainRouter.use("/commissions", commissionRoutes);
mainRouter.use("/admin/commissions", commissionRoutes);

export default mainRouter;