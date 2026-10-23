import { Request, Response, NextFunction } from "express";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import Wishlist from "../models/wishlistModel";
import NurseryProfile from "../models/nurseryProfileModel";
import { findProductAndModel } from "../utils/productRegistry";
import { IWishlistDocument } from "../types/cartWishlist.types";
import cacheManager from "../utils/cacheManager";

// 💚 1. TOGGLE WISHLIST ITEM
export const toggleWishlistItem = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { productId } = req.body;
    const userId = req.user?._id;

    if (!productId) return next(new ErrorHandler("productId is required", 400));

    const { product, modelName } = await findProductAndModel(productId);
    if (!product || !modelName) {
      return next(new ErrorHandler("Product not found in system catalogs", 404));
    }

    // 🛑 सुरक्षा चेक: अगर नर्सरी ब्लॉक है, तो यूजर इसे अपनी विशलिस्ट में नहीं जोड़ सकता
    const nurseryProfile = await NurseryProfile.findOne({ nursery: product.nursery });
    if (nurseryProfile && !nurseryProfile.isActive) {
      return next(new ErrorHandler("This product is currently unavailable as the nursery is blocked.", 400));
    }

    let wishlist = await Wishlist.findOne({ user: userId }) as IWishlistDocument | null;

    if (!wishlist) {
      const newWishlist = await Wishlist.create({
        user: userId,
        items: [{ product: productId, itemModel: modelName }]
      });

      const populatedWishlist = await Wishlist.findById(newWishlist._id).populate({
        path: "items.product",
        select: "name price images coverImage stock slug nursery"
      });

      return res.status(200).json({ success: true, message: "Added to wishlist", wishlist: populatedWishlist });
    }

    const itemIndex = wishlist.items.findIndex((item) => item.product.toString() === productId);

    if (itemIndex > -1) {
      wishlist.items.splice(itemIndex, 1);
    } else {
      wishlist.items.push({ product: productId, itemModel: modelName });
    }

    await wishlist.save();

    const populatedWishlist = await Wishlist.findById(wishlist._id).populate({
      path: "items.product",
      select: "name price images coverImage stock slug nursery"
    });

    const message = itemIndex > -1 ? "Removed from wishlist" : "Added to wishlist";
    return res.status(200).json({ success: true, message, wishlist: populatedWishlist });
  }
);

// 📖 2. GET USER WISHLIST GRID (With Active Nursery Filtration)
export const getMyWishlist = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    let wishlist = await Wishlist.findOne({ user: req.user?._id }).populate({
      path: "items.product",
      select: "name price images coverImage stock slug nursery"
    });

    if (!wishlist) {
      wishlist = await Wishlist.create({ user: req.user?._id, items: [] });
    } else if (wishlist.items.length > 0) {
      // 🛑 सुरक्षा चेक: ब्लॉक की गई नर्सरी के प्रोडक्ट्स को विशलिस्ट ग्रिड से ऑटो-फिल्टर करें (Cached for performance)
      const activeNurseryIds = await cacheManager.getOrSet(
        "nurseries:active_ids_list",
        async () => {
          const activeNurseries = await NurseryProfile.find({ isActive: true }).select("nursery").lean();
          return activeNurseries.map((n) => n.nursery.toString());
        },
        300
      );

      const originalLength = wishlist.items.length;
      wishlist.items = wishlist.items.filter((item: any) => {
        if (!item.product || !item.product.nursery) return false;
        return activeNurseryIds.includes(item.product.nursery.toString());
      }) as any;

      if (wishlist.items.length !== originalLength) {
        await wishlist.save();
      }
    }

    res.status(200).json({ success: true, wishlist });
  }
);

// 🧹 3. CLEAR ENTIRE WISHLIST
export const clearMyWishlist = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    let wishlist = await Wishlist.findOne({ user: req.user?._id }) as IWishlistDocument | null;

    if (!wishlist) {
      wishlist = await Wishlist.create({ user: req.user?._id, items: [] });
    } else {
      wishlist.items = [] as any;
      await wishlist.save();
    }

    res.status(200).json({ success: true, message: "Wishlist cleared successfully", wishlist });
  }
);