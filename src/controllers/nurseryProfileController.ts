import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import slugify from "slugify";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import NurseryProfile from "../models/nurseryProfileModel";
import User from "../models/userModel";
import Plant from "../models/plantsModel";
import Pot from "../models/potsModel";
import Accessory from "../models/accessoriesModel";
import GardeningTool from "../models/gardeningToolsModel";
import PlantCare from "../models/plantCareModel";
import SeedsBulbs from "../models/seedsBulbsModel";
import PlantStandsShelves from "../models/plantStandsShelvesModel";
import ArtificialDriedPlant from "../models/artificialDriedPlantModel";
import Order from "../models/orderModel";
import { UploadedFile } from "express-fileupload";
import cloudinary from "cloudinary";
import { TApprovalStatus, TVerificationStatus, TDocumentType } from "../types/nursery.types";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
  ALLOWED_DOCUMENT_KEYS,
} from "../utils/uploadHelper";
import {
  getNearbyPincodeList,
  normalizeIndianPincode,
  PincodeServiceError,
  getServiceRadiusKm,
  isIncompleteDeliveryCoverage,
} from "../utils/pincodeService";
import {
  sendNurseryApplicationReceivedEmail,
  sendNurseryStatusEmail,
  getAdminNewUserAlertHtml,
} from "../templates/emails";
import sendEmail, { getEmailConfig } from "../utils/sendEmail";
import {
  getActiveCommissionMap,
  getEffectiveCommission,
  clearCommissionCache,
  DEFAULT_CATEGORY_COMMISSIONS,
} from "../utils/commissionService";


const resolveDeliveryPincodes = (pinCode: string): string[] => {
  try {
    const radiusKm = getServiceRadiusKm();
    const deliveryPincodes = getNearbyPincodeList(pinCode, radiusKm);

    console.log(
      `[nurseryProfile] Primary PIN: ${pinCode} | Radius: ${radiusKm} km | Nearby PIN count: ${deliveryPincodes.length} | deliveryPincodes saved: ${deliveryPincodes.length}`
    );
    console.log(`[nurseryProfile] deliveryPincodes: ${JSON.stringify(deliveryPincodes)}`);

    if (!deliveryPincodes.includes(pinCode)) {
      deliveryPincodes.unshift(pinCode);
    }

    return deliveryPincodes;
  } catch (error) {
    if (error instanceof PincodeServiceError) {
      throw new ErrorHandler(error.message, 400);
    }
    throw error;
  }
};

// ======================================================================
// 📝 1. REQUEST TO BECOME A NURSERY (Basic Info + Primary PIN → coverage)
// ======================================================================
export const requestNurseryOnboarding = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { businessName, businessEmail, businessPhone, businessAddress } = req.body;

    if (!businessName || !businessEmail || !businessPhone) {
      return next(
        new ErrorHandler("Please provide basic business details (Name, Email, Phone).", 400)
      );
    }

    if (!businessAddress?.pinCode) {
      return next(new ErrorHandler("Please enter a valid 6-digit PIN code.", 400));
    }

    if (!businessAddress?.city || !businessAddress?.address) {
      return next(
        new ErrorHandler("Please provide city and full address for your nursery location.", 400)
      );
    }

    const existingRequest = await NurseryProfile.findOne({ nursery: req.user?._id });
    if (existingRequest) {
      return next(
        new ErrorHandler(
          `You have already submitted an application. Status: ${existingRequest.approvalStatus}`,
          400
        )
      );
    }

    let normalizedPin: string;
    let deliveryPincodes: string[];

    try {
      normalizedPin = normalizeIndianPincode(businessAddress.pinCode);
      deliveryPincodes = resolveDeliveryPincodes(normalizedPin);
    } catch (error) {
      if (error instanceof ErrorHandler) {
        return next(error);
      }
      if (error instanceof PincodeServiceError) {
        return next(new ErrorHandler(error.message, 400));
      }
      throw error;
    }

    const profile = await NurseryProfile.create({
      nursery: req.user?._id,
      businessName,
      businessEmail,
      businessPhone,
      businessAddress: {
        address: String(businessAddress.address).trim(),
        city: String(businessAddress.city).trim(),
        state: businessAddress.state ? String(businessAddress.state).trim() : "",
        pinCode: normalizedPin,
        country: businessAddress.country || "India",
      },
      approvalStatus: "Pending",
      isActive: true,
      deliveryPincodes,
    });

    console.log(
      `[nurseryProfile] Created nursery ${profile._id} with deliveryPincodes.length=${profile.deliveryPincodes?.length}`
    );

    // 📧 Non-blocking: Acknowledge application submission to vendor + alert admin
    if (req.user?.email) {
      sendNurseryApplicationReceivedEmail(
        req.user.email,
        req.user.name || "Vendor",
        businessName,
        profile._id.toString()
      ).catch((err) =>
        console.error("❌ [Email Trigger Failed] Event: NurseryApplicationReceived, Error:", err?.message)
      );
    }

    const config = getEmailConfig();
    if (config.adminEmail) {
      sendEmail({
        email: config.adminEmail,
        subject: `🏡 [New Nursery Application] ${businessName} from ${req.user?.name}`,
        message: `New nursery vendor application: ${businessName} by ${req.user?.name} (${req.user?.email})`,
        html: getAdminNewUserAlertHtml("Vendor", req.user?.name || "Vendor", req.user?.email || ""),
      }).catch((err) =>
        console.error("❌ [Email Trigger Failed] Event: AdminNurseryApplicationAlert, Error:", err?.message)
      );
    }

    res.status(201).json({
      success: true,
      message:
        "Application submitted successfully. Service coverage PIN codes were generated from your primary PIN. Waiting for Admin Approval.",
      profile,
    });

  }
);

// ======================================================================
// 🏡 2. UPDATE FULL DETAILS (Approved nurseries — recalculate on PIN change)
// ======================================================================
export const updateNurseryProfileDetails = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      businessName,
      businessEmail,
      businessPhone,
      businessAddress,
      bankDetails,
      gstin,
      panNumber,
    } = req.body;

    // Never trust client-supplied coverage lists
    if (req.body.deliveryPincodes !== undefined) {
      delete req.body.deliveryPincodes;
    }

    const profile = await NurseryProfile.findOne({ nursery: req.user?._id });

    if (!profile) {
      return next(new ErrorHandler("Nursery Profile not found. Please apply first.", 404));
    }

    if (profile.approvalStatus !== "Approved") {
      return next(
        new ErrorHandler(
          `Your profile is currently '${profile.approvalStatus}'. You can update full details only after Admin Approval.`,
          403
        )
      );
    }

    if (businessName) profile.businessName = businessName;
    if (businessEmail) profile.businessEmail = businessEmail;
    if (businessPhone) profile.businessPhone = businessPhone;
    if (gstin) profile.gstin = gstin;
    if (panNumber) profile.panNumber = panNumber;

    if (businessAddress) {
      profile.businessAddress = { ...profile.businessAddress, ...businessAddress };

      if (businessAddress.pinCode) {
        let normalizedPin: string;
        let deliveryPincodes: string[];

        try {
          normalizedPin = normalizeIndianPincode(businessAddress.pinCode);
          deliveryPincodes = resolveDeliveryPincodes(normalizedPin);
        } catch (error) {
          if (error instanceof ErrorHandler) {
            return next(error);
          }
          if (error instanceof PincodeServiceError) {
            return next(new ErrorHandler(error.message, 400));
          }
          throw error;
        }

        profile.businessAddress.pinCode = normalizedPin;
        profile.set("deliveryPincodes", deliveryPincodes);
        profile.markModified("deliveryPincodes");
      }
    }

    if (bankDetails) {
      profile.bankDetails = { ...profile.bankDetails, ...bankDetails };
    }

    await profile.save();

    const radiusKm = getServiceRadiusKm();

    res.status(200).json({
      success: true,
      message: `Nursery profile updated. Delivery coverage refreshed for a ${radiusKm} km radius.`,
      profile: {
        ...profile.toObject(),
        serviceRadiusKm: radiusKm,
      },
    });
  }
);

// ======================================================================
// 🔍 3. GET CURRENT NURSERY PROFILE (For Self Dashboard View)
// ======================================================================
export const getMyNurseryProfile = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    let profile = await NurseryProfile.findOne({
      $or: [{ nursery: req.user?._id }, { _id: req.user?._id }],
    })
      .select("+bankDetails.accountNumber +bankDetails.ifscCode")
      .populate("nursery", "name email avatar");

    if (!profile) {
      profile = await NurseryProfile.create({
        nursery: req.user?._id,
        businessName: req.user?.name ? `${req.user.name}'s Nursery` : "Nursery Vendor",
        businessEmail: req.user?.email || "vendor@nursery.com",
        businessPhone: (req.user as any)?.phone || "0000000000",
        businessAddress: {
          address: "Address Pending",
          city: "Indore",
          state: "Madhya Pradesh",
          pinCode: "452001",
          country: "India",
        },
        approvalStatus: "Pending",
        verificationStatus: "Pending",
        isActive: true,
        deliveryPincodes: ["452001"],
      });
      await profile.populate("nursery", "name email avatar");
    }

    const primaryPin = profile.businessAddress?.pinCode;
    // Backfill nurseries stuck with only the primary PIN from the old stub locator
    if (isIncompleteDeliveryCoverage(primaryPin, profile.deliveryPincodes)) {
      try {
        const refreshed = resolveDeliveryPincodes(normalizeIndianPincode(String(primaryPin)));
        if (refreshed.length > (profile.deliveryPincodes?.length || 0)) {
          profile.set("deliveryPincodes", refreshed);
          profile.markModified("deliveryPincodes");
          await profile.save();
          console.log(
            `[nurseryProfile] Backfilled deliveryPincodes for ${profile._id}: ${refreshed.length} PINs`
          );
        }
      } catch (error) {
        console.error(
          `[nurseryProfile] Failed to backfill deliveryPincodes for ${profile._id}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    const profileObj = profile.toObject();

    if (profileObj.bankDetails && profileObj.bankDetails.accountNumber) {
      const accNum = String(profileObj.bankDetails.accountNumber).trim();

      if (accNum.length > 4) {
        const lastFourDigits = accNum.slice(-4);
        const maskedSection = "*".repeat(accNum.length - 4);
        profileObj.bankDetails.accountNumber = `${maskedSection}${lastFourDigits}`;
      } else {
        profileObj.bankDetails.accountNumber = "****";
      }
    }

    res.status(200).json({
      success: true,
      profile: {
        ...profileObj,
        serviceRadiusKm: getServiceRadiusKm(),
      },
    });
  }
);

// ======================================================================
// 🛡️ 4. ADMIN: REVIEW & ACTION ON APPLICATION (Approve / Reject)
// ======================================================================
export const reviewNurseryApplication = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { status, rejectionReason } = req.body;

    if (!["Approved", "Rejected"].includes(status)) {
      return next(new ErrorHandler("Invalid review status action", 400));
    }

    const profile = await NurseryProfile.findById(req.params.id);
    if (!profile) return next(new ErrorHandler("Application request not found", 404));

    profile.approvalStatus = status as TApprovalStatus;

    if (status === "Rejected") {
      profile.rejectionReason = rejectionReason || "Document verification failed.";
    } else {
      profile.rejectionReason = undefined;
      await User.findByIdAndUpdate(profile.nursery, { role: "nursery" });
    }

    await profile.save();

    // 📧 Non-blocking: Notify nursery vendor of application decision
    const nurseryUser = await User.findById(profile.nursery).select("name email").lean();
    if (nurseryUser?.email) {
      sendNurseryStatusEmail(
        nurseryUser.email,
        (nurseryUser as any).name || "Vendor",
        profile.businessName,
        status as "Approved" | "Rejected",
        status === "Rejected" ? (rejectionReason || "Document verification failed.") : undefined
      ).catch((err) =>
        console.error(`❌ [Email Trigger Failed] Event: NurseryStatus-${status}, Error:`, err?.message)
      );
    }

    res.status(200).json({
      success: true,
      message: `Nursery application status changed to ${status}`,
      profile,
    });

  }
);

// ======================================================================
// 🛡️ 5. ADMIN: GET ALL APPLICATIONS BY STATUS
// ======================================================================
export const getAllNurseryApplications = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawStatus = req.query.status ? String(req.query.status) : "Pending";

    const allowedStatuses: TApprovalStatus[] = ["Pending", "Approved", "Rejected"];
    const statusFilter: TApprovalStatus = allowedStatuses.includes(rawStatus as TApprovalStatus)
      ? (rawStatus as TApprovalStatus)
      : "Pending";

    const applications = await NurseryProfile.find({ approvalStatus: statusFilter })
      .populate("nursery", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: applications.length,
      applications,
    });
  }
);

// ======================================================================
// 🛡️ 6. ADMIN: TOGGLE NURSERY ACTIVE/INACTIVE STATUS
// ======================================================================
export const toggleNurseryStatus = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return next(new ErrorHandler("Invalid payload. 'isActive' must be a boolean value.", 400));
    }

    let updatedProfile = null;
    let targetUserId = null;

    updatedProfile = await NurseryProfile.findById(id);

    if (updatedProfile) {
      targetUserId = updatedProfile.nursery;
    } else {
      targetUserId = id;
    }

    const targetUser = await User.findById(targetUserId);

    if (!targetUser) {
      return next(new ErrorHandler("Associated user account not found in the cluster.", 404));
    }

    if (targetUser.role !== "nursery") {
      return next(
        new ErrorHandler(
          "Access denied. Target user does not possess a valid nursery vendor role authorization.",
          403
        )
      );
    }

    targetUser.isActive = isActive;
    await User.findByIdAndUpdate(targetUserId, { $set: { isActive } });

    updatedProfile = await NurseryProfile.findOneAndUpdate(
      { nursery: targetUserId },
      { $set: { isActive } },
      { new: true, runValidators: true }
    );

    if (!updatedProfile) {
      return next(
        new ErrorHandler("Nursery profile structural record matrix not found for this vendor.", 404)
      );
    }

    res.status(200).json({
      success: true,
      message: `Nursery profile and associated user account status successfully updated to ${updatedProfile.isActive ? "Active" : "Inactive"}.`,
      isActive: updatedProfile.isActive,
    });
  }
);

// ======================================================================
// 🏪 7. PUBLIC: GET VENDOR / NURSERY BY SLUG (Includes Products & Stats)
// ======================================================================
export const getPublicVendorBySlug = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawSlug = req.params.slug;
    const slug = String(Array.isArray(rawSlug) ? rawSlug[0] : rawSlug);
    if (!slug) {
      return next(new ErrorHandler("Vendor slug or ID is required", 400));
    }

    if (process.env.NODE_ENV !== "production") {
      console.log(`[getPublicVendorBySlug] slug received: "${slug}"`);
    }

    // 1. Decode the slug string
    const decodedSlug = decodeURIComponent(slug).trim();
    let profile = null;

    // 2. Query MongoDB with ID-first priority and fallback support:
    // Priority 1: Direct MongoDB _id lookup (_id, nursery, nurseryId, userId)
    if (mongoose.Types.ObjectId.isValid(decodedSlug)) {
      profile = await NurseryProfile.findOne({
        $or: [
          { _id: decodedSlug },
          { nursery: decodedSlug },
          { nurseryId: decodedSlug },
          { userId: decodedSlug },
          { slug: decodedSlug },
        ],
      }).populate("nursery", "name businessName email avatar logo createdAt");

      // Fallback: If no NurseryProfile exists but nursery User exists by _id
      if (!profile) {
        const nurseryUser = await User.findById(decodedSlug);
        if (nurseryUser && (nurseryUser.role === "nursery" || (nurseryUser as any).isSeller)) {
          profile = await NurseryProfile.findOne({ nursery: nurseryUser._id }).populate(
            "nursery",
            "name businessName email avatar logo createdAt"
          );
        }
      }
    }

    // Priority 2: Slug lookup fallback
    if (!profile) {
      profile = await NurseryProfile.findOne({
        slug: { $regex: new RegExp(`^${decodedSlug}$`, "i") },
      }).populate("nursery", "name businessName email avatar logo createdAt");
    }

    // Priority 3: Normalized Name fallback
    if (!profile) {
      const normalizedName = decodedSlug.replace(/-/g, " ");
      profile = await NurseryProfile.findOne({
        $or: [
          { name: { $regex: new RegExp(`^${normalizedName}$`, "i") } },
          { businessName: { $regex: new RegExp(`^${normalizedName}$`, "i") } },
        ],
      }).populate("nursery", "name businessName email avatar logo createdAt");
    }

    // Priority 4: Match by nursery user name
    if (!profile) {
      const normalizedName = decodedSlug.replace(/-/g, " ");
      const userMatch = await User.findOne({
        name: { $regex: new RegExp(`^${normalizedName}$`, "i") },
        role: "nursery",
      });
      if (userMatch) {
        profile = await NurseryProfile.findOne({ nursery: userMatch._id }).populate(
          "nursery",
          "name businessName email avatar logo createdAt"
        );
      }
    }

    // If profile still not found after all fallbacks, return 404
    if (!profile) {
      return next(new ErrorHandler(`Vendor/Nursery not found for: ${slug}`, 404));
    }

    const nurseryUserId = profile.nursery?._id || profile.nursery;
    const profileId = profile._id;

    // Strict vendor ID list to match any representation in product docs
    const vendorQueryIds = [
      nurseryUserId,
      profileId,
      ...(mongoose.Types.ObjectId.isValid(String(nurseryUserId))
        ? [new mongoose.Types.ObjectId(String(nurseryUserId))]
        : []),
      ...(mongoose.Types.ObjectId.isValid(String(profileId))
        ? [new mongoose.Types.ObjectId(String(profileId))]
        : []),
      String(nurseryUserId),
      String(profileId),
    ];

    // Ensure listed products lookup uses { nurseryId: vendor._id, status: 'Active' } without throwing if empty
    const catalogFilter = {
      $or: [
        { nursery: { $in: vendorQueryIds } },
        { nurseryId: { $in: vendorQueryIds } },
        { vendor: { $in: vendorQueryIds } },
      ],
      $and: [
        {
          $or: [
            { status: "Active" },
            { status: { $regex: /^active$/i } },
            { isActive: true },
            { isActive: { $ne: false } },
          ],
        },
      ],
    };

    // Fetch catalog products safely without throwing if product array is empty
    const [
      plants = [],
      pots = [],
      accessories = [],
      gardeningTools = [],
      plantCare = [],
      seedsBulbs = [],
      plantStands = [],
      artificialDriedPlants = [],
    ] = await Promise.all([
      Plant.find(catalogFilter).select("-reviews").lean().catch(() => []),
      Pot.find(catalogFilter).select("-reviews").lean().catch(() => []),
      Accessory.find(catalogFilter).select("-reviews").lean().catch(() => []),
      GardeningTool.find(catalogFilter).select("-reviews").lean().catch(() => []),
      PlantCare.find(catalogFilter).select("-reviews").lean().catch(() => []),
      SeedsBulbs.find(catalogFilter).select("-reviews").lean().catch(() => []),
      PlantStandsShelves.find(catalogFilter).select("-reviews").lean().catch(() => []),
      ArtificialDriedPlant.find(catalogFilter).select("-reviews").lean().catch(() => []),
    ]);

    const vendorSlug = profile.slug || slugify(profile.businessName || "nursery", { lower: true, strict: true });
    const vendorIdStr = String(profile._id);
    const nurseryUserIdStr = String(nurseryUserId);

    const mapProduct = (
      p: any,
      type: string,
      defaultCategory: string,
      badge: string,
      badgeColor: string,
      fallbackEmoji: string
    ) => ({
      id: String(p._id),
      _id: String(p._id),
      slug: p.slug,
      type,
      category: p.category || defaultCategory,
      name: p.name,
      vendor: profile.businessName,
      vendorName: profile.businessName,
      vendorId: vendorIdStr,
      nurseryId: nurseryUserIdStr,
      vendorSlug,
      vendorObj: {
        _id: vendorIdStr,
        id: vendorIdStr,
        nurseryId: nurseryUserIdStr,
        name: profile.businessName,
        slug: vendorSlug,
        location: profile.businessAddress?.city || "Indore",
      },
      nursery: {
        _id: vendorIdStr,
        id: vendorIdStr,
        nurseryId: nurseryUserIdStr,
        name: profile.businessName,
        slug: vendorSlug,
        location: profile.businessAddress?.city || "Indore",
      },
      price: p.price,
      originalPrice: Math.round(p.price * 1.25),
      rating: p.ratings || 4.5,
      reviews: p.numOfReviews || 0,
      badge,
      badgeColor,
      tag: p.stock <= 5 && p.stock > 0 ? "Limited" : null,
      emoji: p.coverImage?.url || fallbackEmoji,
    });

    const formattedProducts = [
      ...plants.map((p) =>
        mapProduct(p, "plants", "Indoor Plants", "Bestseller", "#059669", "🌿")
      ),
      ...pots.map((p) =>
        mapProduct(p, "pots", "Ceramic Pots", "Handmade", "#d97706", "🏺")
      ),
      ...accessories.map((a) =>
        mapProduct(a, "accessories", "Plant Care", "Organic", "#16a34a", "🛠️")
      ),
      ...gardeningTools.map((t) =>
        mapProduct(t, "gardening-tools", "Hand Tools", "Durable", "#0f766e", "🔧")
      ),
      ...plantCare.map((c) =>
        mapProduct(c, "plant-care", "Organic Fertilizers", "Care", "#15803d", "🧴")
      ),
      ...seedsBulbs.map((s) =>
        mapProduct(s, "seeds-bulbs", "Vegetable Seeds", "Grow", "#65a30d", "🌱")
      ),
      ...plantStands.map((s) =>
        mapProduct(s, "plant-stands-shelves", "Plant Stands", "Display", "#b45309", "🪜")
      ),
      ...artificialDriedPlants.map((a) =>
        mapProduct(a, "artificial-dried-plants", "Artificial Plants", "Decor", "#9f1239", "🥀")
      ),
    ];

    // Compute vendor statistics
    const ownerUser = profile.nursery as any;
    const joinedYear = ownerUser?.createdAt ? new Date(ownerUser.createdAt).getFullYear() : 2022;
    const joinedMonth = ownerUser?.createdAt ? new Date(ownerUser.createdAt).toLocaleString("default", { month: "long" }) : "January";

    // Query order metrics for this vendor
    const ordersCount = await Order.countDocuments({
      "orderItems.nursery": { $in: [nurseryUserId, profile._id] },
    });

    const totalReviews = formattedProducts.reduce((acc, curr) => acc + curr.reviews, profile.numOfReviews || 0);
    const avgRating = profile.rating || 4.8;

    const vendorData = {
      id: vendorIdStr,
      vendorId: vendorIdStr,
      nurseryId: nurseryUserIdStr,
      name: profile.businessName || "Certified Nursery",
      businessName: profile.businessName || "Certified Nursery",
      slug: vendorSlug,
      avatar: ownerUser?.avatar?.url || "https://res.cloudinary.com/dh200s1m5/image/upload/v1788531235/planto/blogs/q8gghg2xefvcnywokqbw.png",
      coverImage: profile.coverImage?.url || "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&q=80&w=1600",
      verified: profile.approvalStatus === "Approved",
      joinedDate: `${joinedMonth} ${joinedYear}`,
      location: `${profile.businessAddress?.city || "Indore"}, ${profile.businessAddress?.state || "Madhya Pradesh"}`,
      address: profile.businessAddress?.address || "",
      city: profile.businessAddress?.city || "Indore",
      state: profile.businessAddress?.state || "Madhya Pradesh",
      email: profile.businessEmail || ownerUser?.email || "",
      phone: profile.businessPhone || "",
      description: profile.description || "Curating rare houseplants, handcrafted ceramic pots, and premium organic soils. Bringing nature closer to your living spaces with sustainable and healthy greenery.",
      bio: profile.description || "Curating rare houseplants, handcrafted ceramic pots, and premium organic soils. Bringing nature closer to your living spaces with sustainable and healthy greenery.",
      rating: avgRating,
      stats: {
        lifetimeRating: avgRating,
        totalReviews,
        totalSales: Math.max(ordersCount * 3 + formattedProducts.length * 15, 120),
        productsCount: formattedProducts.length,
        responseRate: "99%",
      },
      ratingBreakdown: {
        5: 85,
        4: 10,
        3: 3,
        2: 1,
        1: 1,
      },
      products: formattedProducts,
    };

    res.status(200).json({
      success: true,
      vendor: vendorData,
    });
  }
);

// ======================================================================
// 🏪 7b. PUBLIC: GET VENDOR PRODUCTS STRICTLY BY VENDOR ID / SLUG
// ======================================================================
export const getVendorProducts = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawParam = req.params.slug || req.params.vendorId || req.params.id;
    const slug = String(Array.isArray(rawParam) ? rawParam[0] : rawParam);
    if (!slug) {
      return next(new ErrorHandler("Vendor identifier is required", 400));
    }

    let profile = null;
    const cleanSlug = slug.toLowerCase().trim();

    // 1. Try finding by slug exact match
    profile = await NurseryProfile.findOne({ slug: cleanSlug }).populate("nursery", "name email avatar");

    // 2. Fallback: Try finding by ObjectId
    if (!profile && mongoose.Types.ObjectId.isValid(slug)) {
      profile = await NurseryProfile.findOne({
        $or: [{ _id: slug }, { nursery: slug }],
      }).populate("nursery", "name email avatar");
    }

    // 3. Fallback: Try regex match
    if (!profile) {
      profile = await NurseryProfile.findOne({
        $or: [
          { slug: new RegExp(`^${cleanSlug}$`, "i") },
          { businessName: new RegExp(`^${cleanSlug.replace(/-/g, " ")}$`, "i") },
        ],
      }).populate("nursery", "name email avatar");
    }

    // 4. Fallback: Try slugified businessName
    if (!profile) {
      const profiles = await NurseryProfile.find({}).populate("nursery", "name email avatar");
      profile = profiles.find((p) => {
        const pSlug = (p.slug || slugify(p.businessName || "", { lower: true, strict: true })).toLowerCase();
        return pSlug === cleanSlug;
      }) || null;
    }

    // 5. Fallback: Try matching by nursery User name slugified
    if (!profile) {
      const nurseryUsers = await User.find({ role: "nursery" }).select("name _id");
      for (const u of nurseryUsers) {
        const userNameSlug = slugify(u.name || "", { lower: true, strict: true });
        if (userNameSlug === cleanSlug) {
          profile = await NurseryProfile.findOne({ nursery: u._id }).populate("nursery", "name email avatar") || null;
          if (profile) break;
        }
      }
    }

    if (!profile) {
      return next(new ErrorHandler(`Vendor/Nursery not found for: ${slug}`, 404));
    }

    const nurseryUserId = profile.nursery?._id || profile.nursery;
    const profileId = profile._id;

    const vendorQueryIds = [
      nurseryUserId,
      profileId,
      ...(mongoose.Types.ObjectId.isValid(String(nurseryUserId)) ? [new mongoose.Types.ObjectId(String(nurseryUserId))] : []),
      ...(mongoose.Types.ObjectId.isValid(String(profileId)) ? [new mongoose.Types.ObjectId(String(profileId))] : []),
      String(nurseryUserId),
      String(profileId),
    ];

    // Use $ne: false so products without isActive field (undefined) are still included
    const catalogFilter = {
      $or: [
        { nursery: { $in: vendorQueryIds } },
        { nurseryId: { $in: vendorQueryIds } },
        { vendor: { $in: vendorQueryIds } },
      ],
      isActive: { $ne: false },
    };

    const [plants, pots, accessories, gardeningTools, plantCare, seedsBulbs, plantStands, artificialDriedPlants] =
      await Promise.all([
        Plant.find(catalogFilter).select("-reviews").lean(),
        Pot.find(catalogFilter).select("-reviews").lean(),
        Accessory.find(catalogFilter).select("-reviews").lean(),
        GardeningTool.find(catalogFilter).select("-reviews").lean(),
        PlantCare.find(catalogFilter).select("-reviews").lean(),
        SeedsBulbs.find(catalogFilter).select("-reviews").lean(),
        PlantStandsShelves.find(catalogFilter).select("-reviews").lean(),
        ArtificialDriedPlant.find(catalogFilter).select("-reviews").lean(),
      ]);

    const vendorSlug = profile.slug || slugify(profile.businessName || "nursery", { lower: true, strict: true });
    const vendorIdStr = String(profile._id);
    const nurseryUserIdStr = String(nurseryUserId);

    const mapProduct = (
      p: any,
      type: string,
      defaultCategory: string,
      badge: string,
      badgeColor: string,
      fallbackEmoji: string
    ) => ({
      id: String(p._id),
      _id: String(p._id),
      slug: p.slug,
      type,
      category: p.category || defaultCategory,
      name: p.name,
      vendor: profile.businessName,
      vendorName: profile.businessName,
      vendorId: vendorIdStr,
      nurseryId: nurseryUserIdStr,
      vendorSlug,
      price: p.price,
      originalPrice: Math.round(p.price * 1.25),
      rating: p.ratings || 4.5,
      reviews: p.numOfReviews || 0,
      badge,
      badgeColor,
      tag: p.stock <= 5 && p.stock > 0 ? "Limited" : null,
      emoji: p.coverImage?.url || fallbackEmoji,
    });

    const formattedProducts = [
      ...plants.map((p) => mapProduct(p, "plants", "Indoor Plants", "Bestseller", "#059669", "🌿")),
      ...pots.map((p) => mapProduct(p, "pots", "Ceramic Pots", "Handmade", "#d97706", "🏺")),
      ...accessories.map((a) => mapProduct(a, "accessories", "Plant Care", "Organic", "#16a34a", "🛠️")),
      ...gardeningTools.map((t) => mapProduct(t, "gardening-tools", "Hand Tools", "Durable", "#0f766e", "🔧")),
      ...plantCare.map((c) => mapProduct(c, "plant-care", "Organic Fertilizers", "Care", "#15803d", "🧴")),
      ...seedsBulbs.map((s) => mapProduct(s, "seeds-bulbs", "Vegetable Seeds", "Grow", "#65a30d", "🌱")),
      ...plantStands.map((s) => mapProduct(s, "plant-stands-shelves", "Plant Stands", "Display", "#b45309", "🪜")),
      ...artificialDriedPlants.map((a) => mapProduct(a, "artificial-dried-plants", "Artificial Plants", "Decor", "#9f1239", "🥀")),
    ];

    res.status(200).json({
      success: true,
      count: formattedProducts.length,
      vendor: {
        id: vendorIdStr,
        vendorId: vendorIdStr,
        nurseryId: nurseryUserIdStr,
        name: profile.businessName,
        slug: vendorSlug,
        city: profile.businessAddress?.city || "Indore",
      },
      products: formattedProducts,
    });
  }
);

// ======================================================================
// 🛡️ 8. ADMIN: GET COMPLETE VENDOR DETAILS BY ID
// ======================================================================
export const getAdminVendorDetails = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId);

    let profile = await NurseryProfile.findById(id)
      .select("+bankDetails.accountNumber +bankDetails.ifscCode")
      .populate("nursery", "name email avatar createdAt isActive role");

    if (!profile && mongoose.Types.ObjectId.isValid(id)) {
      profile = await NurseryProfile.findOne({ nursery: id })
        .select("+bankDetails.accountNumber +bankDetails.ifscCode")
        .populate("nursery", "name email avatar createdAt isActive role");
    }

    if (!profile) {
      return next(new ErrorHandler("Vendor / Nursery profile not found", 404));
    }

    const nurseryUserId = profile.nursery?._id || profile.nursery;

    const [plants, pots, accessories, gardeningTools, plantCare, seedsBulbs, plantStands, artificialDriedPlants, orders] =
      await Promise.all([
        Plant.find({ nursery: nurseryUserId }).lean(),
        Pot.find({ nursery: nurseryUserId }).lean(),
        Accessory.find({ nursery: nurseryUserId }).lean(),
        GardeningTool.find({ nursery: nurseryUserId }).lean(),
        PlantCare.find({ nursery: nurseryUserId }).lean(),
        SeedsBulbs.find({ nursery: nurseryUserId }).lean(),
        PlantStandsShelves.find({ nursery: nurseryUserId }).lean(),
        ArtificialDriedPlant.find({ nursery: nurseryUserId }).lean(),
        Order.find({ "orderItems.nursery": nurseryUserId }).lean(),
      ]);

    const totalGrossRevenue = orders.reduce((sum, order) => {
      const nurseryItems = order.orderItems.filter((i: any) => String(i.nursery) === String(nurseryUserId));
      const itemsTotal = nurseryItems.reduce((iSum: number, i: any) => iSum + i.price * i.quantity, 0);
      return sum + itemsTotal;
    }, 0);

    res.status(200).json({
      success: true,
      vendor: {
        profile,
        inventorySummary: {
          totalProducts:
            plants.length +
            pots.length +
            accessories.length +
            gardeningTools.length +
            plantCare.length +
            seedsBulbs.length +
            plantStands.length +
            artificialDriedPlants.length,
          plantsCount: plants.length,
          potsCount: pots.length,
          accessoriesCount: accessories.length,
          gardeningToolsCount: gardeningTools.length,
          plantCareCount: plantCare.length,
          seedsBulbsCount: seedsBulbs.length,
          plantStandsCount: plantStands.length,
          artificialDriedPlantsCount: artificialDriedPlants.length,
          plants,
          pots,
          accessories,
          gardeningTools,
          plantCare,
          seedsBulbs,
          plantStands,
          artificialDriedPlants,
        },
        ordersSummary: {
          totalOrders: orders.length,
          totalGrossRevenue,
        },
      },
    });
  }
);

// ======================================================================
// 📄 9. NURSERY: UPLOAD REGULATORY / ONBOARDING DOCUMENTS (`/nursery/documents`)
// ======================================================================
export const uploadNurseryDocuments = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    let profile = await NurseryProfile.findOne({
      $or: [{ nursery: req.user?._id }, { _id: req.user?._id }],
    });

    if (!profile) {
      profile = await NurseryProfile.create({
        nursery: req.user?._id,
        businessName: req.user?.name ? `${req.user.name}'s Nursery` : "Nursery Vendor",
        businessEmail: req.user?.email || "vendor@nursery.com",
        businessPhone: (req.user as any)?.phone || "0000000000",
        businessAddress: {
          address: "Address Pending",
          city: "Indore",
          state: "Madhya Pradesh",
          pinCode: "452001",
          country: "India",
        },
        approvalStatus: "Pending",
        verificationStatus: "Pending",
        isActive: true,
        deliveryPincodes: ["452001"],
      });
    }

    if (!profile.documents) {
      profile.documents = {};
    }

    const uploadedDocumentsResult: Record<string, any> = {};
    let filesUploadedCount = 0;

    // 1. Ensure req.files and req.body are safely initialized as objects
    const files: any = req.files ? (Array.isArray(req.files) ? {} : req.files) : {};
    const body: any = req.body || {};

    // 2. Safely extract files without throwing undefined errors
    const gstinFile = files["gstin"] || files.gstin || null;
    const panCardFile = files["panCard"] || files.panCard || null;
    const licenseFile = files["nurseryLicense"] || files.nurseryLicense || null;
    const idProofFile = files["identityProof"] || files.identityProof || null;
    const bankDetailsFile = files["bankDetails"] || files.bankDetails || null;

    const fileMap: Record<TDocumentType, any> = {
      gstin: gstinFile,
      panCard: panCardFile,
      nurseryLicense: licenseFile,
      identityProof: idProofFile,
      bankDetails: bankDetailsFile,
    };

    // Process safely extracted files
    for (const docKey of ALLOWED_DOCUMENT_KEYS) {
      const rawFile = fileMap[docKey];
      if (rawFile) {
        const file = (Array.isArray(rawFile) ? rawFile[0] : rawFile) as UploadedFile;

        // Delete previous document asset from Cloudinary if exists
        const existingDoc = profile.documents[docKey];
        if (existingDoc && existingDoc.publicId) {
          await deleteFromCloudinary(existingDoc.publicId);
        }

        // Upload new document to Cloudinary
        const uploadResult = await uploadToCloudinary(file, "urban-nursery/documents");

        profile.documents[docKey] = {
          url: uploadResult.url,
          publicId: uploadResult.publicId,
          status: "Pending",
          rejectionReason: undefined,
          uploadedAt: new Date(),
        };

        uploadedDocumentsResult[docKey] = profile.documents[docKey];
        filesUploadedCount++;
      }
    }

    // Also support base64 strings passed in body if any
    for (const docKey of ALLOWED_DOCUMENT_KEYS) {
      if (body?.[docKey] && typeof body[docKey] === "string" && !uploadedDocumentsResult[docKey]) {
        const docPayload = body[docKey];
        if (docPayload.startsWith("data:") || docPayload.startsWith("http")) {
          let secureUrl = docPayload;
          let publicId = "";

          if (docPayload.startsWith("data:")) {
            const uploadRes = await cloudinary.v2.uploader.upload(docPayload, {
              folder: "urban-nursery/documents",
              resource_type: "auto",
            });
            secureUrl = uploadRes.secure_url;
            publicId = uploadRes.public_id;
          }

          profile.documents[docKey] = {
            url: secureUrl,
            publicId: publicId || undefined,
            status: "Pending",
            rejectionReason: undefined,
            uploadedAt: new Date(),
          };
          uploadedDocumentsResult[docKey] = profile.documents[docKey];
          filesUploadedCount++;
        }
      }
    }

    if (filesUploadedCount === 0) {
      return res.status(400).json({
        success: false,
        message: "No document files were uploaded.",
      });
    }

    profile.verificationStatus = "Pending";
    profile.documentsSubmittedAt = new Date();
    profile.markModified("documents");

    await profile.save();

    return res.status(200).json({
      success: true,
      message: "Documents uploaded successfully for verification.",
      documents: profile.documents,
      verificationStatus: profile.verificationStatus,
      documentsSubmittedAt: profile.documentsSubmittedAt,
      profile,
    });
  }
);

// ======================================================================
// 🛡️ 10. ADMIN: GET FULL NURSERY PROFILE & DOCUMENTS (`/admin/nurseries/:nurseryId`)
// ======================================================================
export const getAdminNurseryVerificationDetails = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.nurseryId || req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId);

    if (!id) {
      return next(new ErrorHandler("Nursery ID is required", 400));
    }

    let profile = await NurseryProfile.findById(id)
      .select("+bankDetails.accountNumber +bankDetails.ifscCode")
      .populate("nursery", "name email avatar createdAt isActive role");

    if (!profile && mongoose.Types.ObjectId.isValid(id)) {
      profile = await NurseryProfile.findOne({ nursery: id })
        .select("+bankDetails.accountNumber +bankDetails.ifscCode")
        .populate("nursery", "name email avatar createdAt isActive role");
    }

    if (!profile) {
      return next(new ErrorHandler("Nursery Profile not found", 404));
    }

    res.status(200).json({
      success: true,
      nursery: {
        _id: profile._id,
        nurseryId: (profile.nursery as any)?._id || profile.nursery,
        businessName: profile.businessName,
        slug: profile.slug,
        businessEmail: profile.businessEmail,
        businessPhone: profile.businessPhone,
        businessAddress: profile.businessAddress,
        bankDetails: profile.bankDetails,
        gstin: profile.gstin,
        panNumber: profile.panNumber,
        documents: profile.documents || {},
        verificationStatus: profile.verificationStatus || "Pending",
        adminReviewNotes: profile.adminReviewNotes,
        documentsSubmittedAt: profile.documentsSubmittedAt,
        approvalStatus: profile.approvalStatus,
        isActive: profile.isActive,
        rejectionReason: profile.rejectionReason,
        rating: profile.rating,
        numOfReviews: profile.numOfReviews,
        coverImage: profile.coverImage,
        owner: profile.nursery,
        deliveryPincodes: profile.deliveryPincodes || [],
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
    });

  }
);

// ======================================================================
// 🛡️ 11. ADMIN: VERIFY DOCUMENTS & OVERALL STATUS (`/admin/nurseries/:nurseryId/verify-documents`)
// ======================================================================
export const verifyNurseryDocuments = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.nurseryId || req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId);

    let profile = await NurseryProfile.findById(id);
    if (!profile && mongoose.Types.ObjectId.isValid(id)) {
      profile = await NurseryProfile.findOne({ nursery: id });
    }

    if (!profile) {
      return next(new ErrorHandler("Nursery Profile not found", 404));
    }

    const {
      verificationStatus,
      adminReviewNotes,
      verificationNotes,
      documentUpdates,
      documentType,
      status,
      rejectionReason,
      documents,
    } = req.body;

    if (!profile.documents) {
      profile.documents = {};
    }

    // 1. Single document status update
    if (documentType && status) {
      if (!ALLOWED_DOCUMENT_KEYS.includes(documentType as TDocumentType)) {
        return next(
          new ErrorHandler(
            `Invalid documentType '${documentType}'. Allowed: ${ALLOWED_DOCUMENT_KEYS.join(", ")}.`,
            400
          )
        );
      }
      if (!["Pending", "Approved", "Rejected"].includes(status)) {
        return next(
          new ErrorHandler("Invalid status. Must be 'Pending', 'Approved', or 'Rejected'.", 400)
        );
      }

      const existingDoc = profile.documents[documentType as TDocumentType] || { status: "Pending" };
      existingDoc.status = status as TVerificationStatus;
      if (status === "Rejected") {
        existingDoc.rejectionReason = rejectionReason || adminReviewNotes || verificationNotes || "Document rejected by admin.";
      } else if (status === "Approved") {
        existingDoc.rejectionReason = undefined;
      }
      profile.documents[documentType as TDocumentType] = existingDoc;
    }

    // 2. Batch document updates map
    const updatesMap = documentUpdates || documents;
    if (updatesMap && typeof updatesMap === "object") {
      for (const [key, val] of Object.entries(updatesMap)) {
        if (ALLOWED_DOCUMENT_KEYS.includes(key as TDocumentType) && val && typeof val === "object") {
          const docVal = val as any;
          const newStatus = docVal.status;
          if (newStatus && ["Pending", "Approved", "Rejected"].includes(newStatus)) {
            const currentDoc = profile.documents[key as TDocumentType] || { status: "Pending" };
            currentDoc.status = newStatus as TVerificationStatus;
            if (newStatus === "Rejected") {
              currentDoc.rejectionReason =
                docVal.rejectionReason ||
                docVal.reason ||
                rejectionReason ||
                adminReviewNotes ||
                verificationNotes ||
                "Document rejected by admin.";
            } else if (newStatus === "Approved") {
              currentDoc.rejectionReason = undefined;
            }
            profile.documents[key as TDocumentType] = currentDoc;
          }
        }
      }
    }

    // 3. Overall verification status update
    const finalReviewNotes = adminReviewNotes || verificationNotes;
    if (verificationStatus) {
      if (!["Pending", "Approved", "Rejected"].includes(verificationStatus)) {
        return next(
          new ErrorHandler(
            "Invalid overall verificationStatus. Must be 'Pending', 'Approved', or 'Rejected'.",
            400
          )
        );
      }
      profile.verificationStatus = verificationStatus as TVerificationStatus;
    }

    if (finalReviewNotes !== undefined) {
      profile.adminReviewNotes = finalReviewNotes;
    }

    // 4. Sync profile approval & nursery user role
    if (profile.verificationStatus === "Approved") {
      profile.approvalStatus = "Approved";
      profile.rejectionReason = undefined;
      await User.findByIdAndUpdate(profile.nursery, { role: "nursery" });
    } else if (profile.verificationStatus === "Rejected") {
      profile.approvalStatus = "Rejected";
      profile.rejectionReason =
        finalReviewNotes || rejectionReason || "Document verification rejected.";
    }

    profile.markModified("documents");
    await profile.save();

    // 📧 Non-blocking: Notify nursery vendor of verification & approval decision
    if (profile.verificationStatus === "Approved" || profile.verificationStatus === "Rejected") {
      User.findById(profile.nursery)
        .select("name email")
        .lean()
        .then((nurseryUser) => {
          if (nurseryUser?.email) {
            sendNurseryStatusEmail(
              nurseryUser.email,
              (nurseryUser as any).name || "Vendor",
              profile.businessName,
              profile.verificationStatus as "Approved" | "Rejected",
              profile.verificationStatus === "Rejected"
                ? (finalReviewNotes || rejectionReason || "Document verification rejected.")
                : undefined
            ).catch((err) =>
              console.error(`❌ [Email Trigger Failed] Event: NurseryVerification-${profile.verificationStatus}, Error:`, err?.message)
            );
          }
        })
        .catch((err) => console.error("Error looking up nursery user for verification email:", err));
    }

    res.status(200).json({
      success: true,
      message: `Nursery verification updated successfully. Status: ${profile.verificationStatus}`,
      nursery: profile,
    });
  }
);

// ======================================================================
// 🛡️ 12. ADMIN: MANAGE SERVICE PINCODES (`PATCH /admin/nurseries/:nurseryId/pincodes`)
// ======================================================================
export const manageNurseryServicePincodes = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.nurseryId || req.params.id;
    const id = String(Array.isArray(rawId) ? rawId[0] : rawId);

    if (!id) {
      return next(new ErrorHandler("Nursery ID is required", 400));
    }

    const { action, pincode, pincodes } = req.body;

    if (!action || !["add", "remove", "set"].includes(action)) {
      return next(
        new ErrorHandler("Invalid action. Must be 'add', 'remove', or 'set'.", 400)
      );
    }

    let profile = await NurseryProfile.findById(id);
    if (!profile && mongoose.Types.ObjectId.isValid(id)) {
      profile = await NurseryProfile.findOne({ nursery: id });
    }

    if (!profile) {
      return next(new ErrorHandler("Nursery Profile not found", 404));
    }

    // Helper: validate a 6-digit Indian pincode
    const isValidPincode = (pin: string): boolean => /^\d{6}$/.test(String(pin).trim());

    if (action === "add") {
      if (!pincode) {
        return next(new ErrorHandler("Please provide a pincode to add.", 400));
      }
      const normalized = String(pincode).trim();
      if (!isValidPincode(normalized)) {
        return next(new ErrorHandler("Pincode must be exactly 6 digits.", 400));
      }
      const updated = await NurseryProfile.findByIdAndUpdate(
        profile._id,
        { $addToSet: { deliveryPincodes: normalized } },
        { new: true, runValidators: true }
      );
      return res.status(200).json({
        success: true,
        message: `Pincode ${normalized} added to service coverage.`,
        deliveryPincodes: updated?.deliveryPincodes || [],
      });
    }

    if (action === "remove") {
      if (!pincode) {
        return next(new ErrorHandler("Please provide a pincode to remove.", 400));
      }
      const normalized = String(pincode).trim();
      const updated = await NurseryProfile.findByIdAndUpdate(
        profile._id,
        { $pull: { deliveryPincodes: normalized } },
        { new: true, runValidators: true }
      );
      return res.status(200).json({
        success: true,
        message: `Pincode ${normalized} removed from service coverage.`,
        deliveryPincodes: updated?.deliveryPincodes || [],
      });
    }

    if (action === "set") {
      if (!Array.isArray(pincodes)) {
        return next(
          new ErrorHandler("Please provide a 'pincodes' array for 'set' action.", 400)
        );
      }
      const invalid = (pincodes as string[]).filter((p) => !isValidPincode(p));
      if (invalid.length > 0) {
        return next(
          new ErrorHandler(
            `Invalid pincodes: ${invalid.join(", ")}. All must be 6-digit numbers.`,
            400
          )
        );
      }
      const uniquePins = [...new Set((pincodes as string[]).map((p) => String(p).trim()))];
      const updated = await NurseryProfile.findByIdAndUpdate(
        profile._id,
        { $set: { deliveryPincodes: uniquePins } },
        { new: true, runValidators: true }
      );
      return res.status(200).json({
        success: true,
        message: `Service pincodes updated. Total: ${updated?.deliveryPincodes?.length || 0}`,
        deliveryPincodes: updated?.deliveryPincodes || [],
      });
    }

    return;
  });


// ======================================================================
// 🛠️ ADMIN: BACKFILL SLUGS for NurseryProfiles missing a slug field
// POST /api/v1/nursery-profile/admin/backfill-slugs
// ======================================================================
export const backfillNurserySlugs = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const profiles = await NurseryProfile.find({
      $or: [{ slug: { $exists: false } }, { slug: null }, { slug: "" }],
    });

    let fixed = 0;
    const results: { id: string; businessName: string; slug: string }[] = [];

    for (const profile of profiles) {
      const baseSlug = slugify(profile.businessName || "nursery", { lower: true, strict: true });
      // Ensure uniqueness
      const existing = await NurseryProfile.findOne({ slug: baseSlug, _id: { $ne: profile._id } });
      const finalSlug = existing
        ? `${baseSlug}-${String(profile._id).slice(-4)}`
        : baseSlug;

      profile.slug = finalSlug;
      await profile.save({ validateBeforeSave: false });
      fixed++;
      results.push({ id: String(profile._id), businessName: profile.businessName, slug: finalSlug });
    }

    res.status(200).json({
      success: true,
      message: `Slug backfill complete. Fixed ${fixed} profile(s).`,
      fixed,
      results,
    });
  }
);

// ======================================================================
// 🪙 ADMIN: GET NURSERY COMMISSION RATES BREAKDOWN
// GET /api/v1/nursery-profile/admin/nurseries/:nurseryId/commission
// ======================================================================
export const getNurseryCommissionRates = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { nurseryId } = req.params;

    const profile = await NurseryProfile.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(nurseryId) ? nurseryId : null },
        { nursery: mongoose.isValidObjectId(nurseryId) ? nurseryId : null },
      ],
    }).lean();

    if (!profile) {
      return next(new ErrorHandler("Nursery profile not found.", 404));
    }

    const globalMap = await getActiveCommissionMap();

    const categoryBreakdown = await Promise.all(
      DEFAULT_CATEGORY_COMMISSIONS.map(async (def) => {
        const effective = await getEffectiveCommission(profile, def.category);
        const globalRate = globalMap[def.category]?.commissionPercentage ?? def.commissionPercentage;
        
        let customPercentage: number | null = null;
        if (Array.isArray(profile.commissionOverrides)) {
          const matchedOverride = profile.commissionOverrides.find(
            (o: any) => String(o.category).toLowerCase().trim() === def.category.toLowerCase().trim()
          );
          if (matchedOverride) {
            customPercentage = matchedOverride.customCommissionPercentage;
          }
        }

        return {
          category: def.category,
          itemModel: def.itemModel,
          globalPercentage: globalRate,
          customPercentage,
          effectivePercentage: effective.percentage,
          isOverridden: effective.source === "NURSERY_OVERRIDE" || effective.source === "NURSERY_DEFAULT",
          source: effective.source,
          description: def.description,
        };
      })
    );

    res.status(200).json({
      success: true,
      nurseryId: profile.nursery,
      profileId: profile._id,
      businessName: profile.businessName,
      defaultNurseryCommission: profile.defaultNurseryCommission ?? null,
      commissionOverrides: profile.commissionOverrides || [],
      categories: categoryBreakdown,
    });
  }
);

// ======================================================================
// 🪙 ADMIN: UPDATE NURSERY COMMISSION OVERRIDES
// PATCH /api/v1/nursery-profile/admin/nurseries/:nurseryId/commission
// ======================================================================
export const updateNurseryCommission = catchAsyncErrors(
  async (req: any, res: Response, next: NextFunction) => {
    const { nurseryId } = req.params;
    const { commissionOverrides, defaultNurseryCommission } = req.body;

    const profile = await NurseryProfile.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(nurseryId) ? nurseryId : null },
        { nursery: mongoose.isValidObjectId(nurseryId) ? nurseryId : null },
      ],
    });

    if (!profile) {
      return next(new ErrorHandler("Nursery profile not found.", 404));
    }

    // Validate commissionOverrides if provided
    if (commissionOverrides !== undefined) {
      if (!Array.isArray(commissionOverrides)) {
        return next(new ErrorHandler("commissionOverrides must be an array of category overrides.", 400));
      }

      const sanitizedOverrides: Array<{ category: string; customCommissionPercentage: number }> = [];
      for (const item of commissionOverrides) {
        if (!item.category) continue;
        const rate = Number(item.customCommissionPercentage);
        if (isNaN(rate) || rate < 0 || rate > 100) {
          return next(new ErrorHandler(`Invalid commission percentage for ${item.category}. Must be between 0 and 100.`, 400));
        }
        sanitizedOverrides.push({
          category: String(item.category).trim(),
          customCommissionPercentage: rate,
        });
      }
      profile.commissionOverrides = sanitizedOverrides;
    }

    // Validate defaultNurseryCommission if provided
    if (defaultNurseryCommission !== undefined) {
      if (defaultNurseryCommission === null || defaultNurseryCommission === "") {
        profile.defaultNurseryCommission = undefined;
      } else {
        const flatRate = Number(defaultNurseryCommission);
        if (isNaN(flatRate) || flatRate < 0 || flatRate > 100) {
          return next(new ErrorHandler("Default nursery commission must be a valid number between 0 and 100.", 400));
        }
        profile.defaultNurseryCommission = flatRate;
      }
    }

    await profile.save();
    clearCommissionCache();

    // Generate fresh breakdown
    const globalMap = await getActiveCommissionMap();
    const categoryBreakdown = await Promise.all(
      DEFAULT_CATEGORY_COMMISSIONS.map(async (def) => {
        const effective = await getEffectiveCommission(profile, def.category);
        const globalRate = globalMap[def.category]?.commissionPercentage ?? def.commissionPercentage;
        
        let customPercentage: number | null = null;
        if (Array.isArray(profile.commissionOverrides)) {
          const matchedOverride = profile.commissionOverrides.find(
            (o: any) => String(o.category).toLowerCase().trim() === def.category.toLowerCase().trim()
          );
          if (matchedOverride) {
            customPercentage = matchedOverride.customCommissionPercentage;
          }
        }

        return {
          category: def.category,
          itemModel: def.itemModel,
          globalPercentage: globalRate,
          customPercentage,
          effectivePercentage: effective.percentage,
          isOverridden: effective.source === "NURSERY_OVERRIDE" || effective.source === "NURSERY_DEFAULT",
          source: effective.source,
          description: def.description,
        };
      })
    );

    res.status(200).json({
      success: true,
      message: `Commission settings updated successfully for "${profile.businessName}".`,
      nursery: profile,
      categories: categoryBreakdown,
    });
  }
);
