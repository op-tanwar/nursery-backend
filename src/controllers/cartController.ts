import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import Cart from "../models/cartModel";
import User from "../models/userModel";
import NurseryProfile from "../models/nurseryProfileModel";
import Product from "../models/productModel";
import {
  ICartDocument,
  IEnrichedCart,
  IEnrichedCartItem,
  UnavailableReason,
} from "../types/cartWishlist.types";
import cacheManager from "../utils/cacheManager";
import { resolveProductCommissionType } from "../utils/productRegistry";

// ======================================================================
// ⚡ RE-EXPORT CENTRALIZED CACHE CONSTANTS & INVALIDATION UTILITIES
// ======================================================================
import {
  ACTIVE_NURSERIES_CACHE_KEY,
  getActiveNurseryIds,
  invalidateNurseryCache,
  isNurseryLiveAndActive,
  isNurseryActiveSync,
} from "../utils/nurseryUtils";

export {
  ACTIVE_NURSERIES_CACHE_KEY,
  getActiveNurseryIds,
  invalidateNurseryCache,
  isNurseryLiveAndActive,
  isNurseryActiveSync,
};

// ======================================================================
// 🛡️ DYNAMIC AVAILABILITY ENRICHMENT & VALIDATION HELPERS
// ======================================================================

/**
 * 🔍 Enriches cart items with dynamic availability flags without mutating database documents.
 * Preserves the customer's cart state permanently in MongoDB and never calls cart.save() on read.
 */
export const enrichCartWithAvailability = async (cart: any): Promise<IEnrichedCart> => {
  const cartObj = cart.toObject ? cart.toObject() : JSON.parse(JSON.stringify(cart));
  const rawItems = cartObj.items || [];

  if (rawItems.length === 0) {
    return {
      ...cartObj,
      items: [],
      subtotal: 0,
      totalAmount: 0,
      availableItemsCount: 0,
      unavailableItemsCount: 0,
    };
  }

  // Helper to safely extract string ID from an ObjectId, object, or string
  const extractId = (val: any): string | null => {
    if (!val) return null;
    if (typeof val === "object" && val._id) return String(val._id).trim();
    return String(val).trim();
  };

  // 1. Collect unique nursery IDs from cart items
  const uniqueNurseryIds: string[] = Array.from(
    new Set(
      rawItems
        .map((item: any) => extractId(item.nursery) || extractId(item.product?.nursery))
        .filter((id: any): id is string => Boolean(id) && id !== "undefined" && id !== "null")
    )
  );

  // 2. Fetch cached active nursery IDs and nursery profiles in parallel
  const [activeNurseryIds, nurseryProfiles] = await Promise.all([
    getActiveNurseryIds(),
    uniqueNurseryIds.length > 0
      ? NurseryProfile.find({
          $or: [
            { nursery: { $in: uniqueNurseryIds as any } },
            { _id: { $in: uniqueNurseryIds as any } },
          ],
        })
          .select("nursery _id isActive approvalStatus businessName isBlocked")
          .lean()
      : [],
  ]);

  // Collect linked user IDs from nursery profiles
  const allUserIds = Array.from(
    new Set([
      ...uniqueNurseryIds,
      ...nurseryProfiles.map((np: any) => extractId(np.nursery)).filter(Boolean),
    ])
  );

  const nurseryUsers = allUserIds.length > 0
    ? await User.find({ _id: { $in: allUserIds as any } })
        .select("_id isActive isBlocked status")
        .lean()
    : [];

  const profileMap = new Map<string, any>();
  for (const np of nurseryProfiles) {
    if (np.nursery) {
      profileMap.set(String(np.nursery), np);
    }
    if (np._id) {
      profileMap.set(String(np._id), np);
    }
  }

  const userMap = new Map<string, any>();
  for (const u of nurseryUsers) {
    userMap.set(String(u._id), u);
  }

  const isNurseryActive = (nurseryId?: string | null): boolean => {
    if (!nurseryId) return true; // Direct platform product or unspecified nursery
    const idStr = nurseryId.toString().trim();
    if (activeNurseryIds.includes(idStr)) {
      return true;
    }

    const profile = profileMap.get(idStr);
    const userId = profile?.nursery ? String(profile.nursery) : idStr;
    const userDoc = userMap.get(userId);

    if (profile) {
      const isProfileActive = isNurseryActiveSync(profile);
      if (!isProfileActive) return false;
    }

    if (userDoc) {
      const isUserActive = isNurseryActiveSync(userDoc);
      if (!isUserActive) return false;
    }

    return activeNurseryIds.includes(idStr);
  };

  // 3. Dynamically evaluate availability and compute subtotal excluding unavailable items
  let subtotal = 0;
  let availableItemsCount = 0;
  let unavailableItemsCount = 0;

  const enrichedItems: IEnrichedCartItem[] = rawItems.map((rawItem: any) => {
    const product = rawItem.product;

    let isAvailable = true;
    let unavailableReason: UnavailableReason | undefined = undefined;

    const nurseryId = extractId(rawItem.nursery) || extractId(product?.nursery);
    const profile = nurseryId ? profileMap.get(nurseryId) : null;
    const nurseryName = profile?.businessName || rawItem.nurseryName || "Certified Nursery";

    if (!product || product.isActive === false || product.isPublished === false) {
      isAvailable = false;
      unavailableReason = "PRODUCT_DISABLED";
    } else if (product.isNurseryActive === false || (nurseryId && !isNurseryActive(nurseryId))) {
      isAvailable = false;
      unavailableReason = "NURSERY_INACTIVE";
    } else {
      const availableStock = Math.max(0, (product.stock || 0) - (product.reservedStock || 0));
      if (availableStock <= 0) {
        isAvailable = false;
        unavailableReason = "OUT_OF_STOCK";
      }
    }

    if (isAvailable && product) {
      const price =
        product.discountPrice != null && product.discountPrice > 0
          ? product.discountPrice
          : (product.price || 0);
      subtotal += price * (rawItem.quantity || 1);
      availableItemsCount += rawItem.quantity || 1;
    } else if (unavailableReason !== "NURSERY_INACTIVE") {
      unavailableItemsCount += rawItem.quantity || 1;
    }

    return {
      ...rawItem,
      nurseryName,
      isAvailable,
      unavailableReason,
    };
  });

  // 🛡️ Filter out items belonging to inactive/suspended nurseries so they are 100% hidden
  // They are never rendered, never show any badge, and never count towards totals
  const visibleItems = enrichedItems.filter(
    (item) => item.unavailableReason !== "NURSERY_INACTIVE" && item.product?.isNurseryActive !== false
  );

  return {
    ...cartObj,
    items: visibleItems,
    subtotal: Math.round(subtotal * 100) / 100,
    totalAmount: Math.round(subtotal * 100) / 100,
    availableItemsCount,
    unavailableItemsCount,
  };
};

/**
 * 🛡️ Helper to validate availability of all items in a user's cart document.
 * Used during checkout to prevent placing orders with unavailable items.
 */
export const checkCartAvailability = async (
  userId: any
): Promise<{
  isValid: boolean;
  unavailableItems: Array<{
    productId: string;
    name: string;
    reason: UnavailableReason;
  }>;
}> => {
  const cart = await Cart.findOne({ user: userId }).populate({
    path: "items.product",
    select: "name price discountPrice stock reservedStock slug nursery isActive category isPublished isNurseryActive",
  });

  if (!cart || !cart.items || cart.items.length === 0) {
    return { isValid: true, unavailableItems: [] };
  }

  const enriched = await enrichCartWithAvailability(cart);
  const unavailableList = enriched.items
    .filter((it) => it.isAvailable === false && it.unavailableReason !== "NURSERY_INACTIVE")
    .map((it) => ({
      productId: String(it.product?._id || it.product || ""),
      name: it.product?.name || "Product",
      reason: it.unavailableReason || "PRODUCT_DISABLED",
    }));

  return {
    isValid: unavailableList.length === 0,
    unavailableItems: unavailableList,
  };
};

// 🛒 1. ADD OR INCREMENT ITEM IN CART
export const addToCart = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { productId, quantity } = req.body;
    const userId = req.user?._id;

    if (!productId || !quantity || quantity < 1) {
      return next(new ErrorHandler("Valid productId and quantity are required", 400));
    }

    const product = await Product.findById(productId);
    if (!product) {
      return next(new ErrorHandler("Product not found in system catalogs", 404));
    }

    // 🛑 सुरक्षा चेक: चेक करें कि क्या इस प्रोडक्ट की नर्सरी एक्टिव है
    if (product.nursery) {
      const activeNurseryIds = await getActiveNurseryIds();
      if (!activeNurseryIds.includes(product.nursery.toString())) {
        return next(new ErrorHandler("This nursery is temporarily blocked by admin. Cannot add product.", 400));
      }
    }

    let cart = await Cart.findOne({ user: userId }) as ICartDocument | null;

    const availableStock = Math.max(0, (product.stock || 0) - (product.reservedStock || 0));

    if (!cart) {
      if (availableStock < quantity) {
        return next(new ErrorHandler(`Only ${availableStock} units available in stock`, 400));
      }
      cart = await Cart.create({
        user: userId,
        items: [{ product: productId, itemModel: resolveProductCommissionType(product), quantity, nursery: product.nursery }]
      }) as unknown as ICartDocument;
    } else {
      const itemIndex = cart.items.findIndex((item) => item.product.toString() === productId);

      if (itemIndex > -1) {
        const cumulativeQuantity = cart.items[itemIndex].quantity + quantity;
        if (availableStock < cumulativeQuantity) {
          return next(new ErrorHandler(`Max available stock limit is ${availableStock}`, 400));
        }
        cart.items[itemIndex].quantity = cumulativeQuantity;
      } else {
        if (availableStock < quantity) {
          return next(new ErrorHandler(`Only ${availableStock} units available in stock`, 400));
        }
        cart.items.push({ product: productId, itemModel: resolveProductCommissionType(product), quantity, nursery: product.nursery });
      }
      await cart.save();
    }

    const updatedCart = await cart.populate({
      path: "items.product",
      select: "name price discountPrice images coverImage stock reservedStock slug nursery isActive category isPublished isNurseryActive"
    });

    const enrichedCart = await enrichCartWithAvailability(updatedCart);
    res.status(200).json({ success: true, cart: enrichedCart });
  }
);

// 🔄 2. UPDATE ITEM QUANTITY DIRECTLY
export const updateCartQuantity = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { productId, quantity } = req.body;
    const userId = req.user?._id;

    if (!productId || quantity < 1) {
      return next(new ErrorHandler("Valid productId and quantity required", 400));
    }

    const product = await Product.findById(productId);
    if (!product) return next(new ErrorHandler("Product not found", 404));

    // 🛑 सुरक्षा चेक: ब्लॉक की गई नर्सरी की क्वांटिटी अपडेट न करने दें
    if (product.nursery) {
      const activeNurseryIds = await getActiveNurseryIds();
      if (!activeNurseryIds.includes(product.nursery.toString())) {
        return next(new ErrorHandler("This product is currently unavailable due to nursery suspension.", 400));
      }
    }

    const availableStock = Math.max(0, (product.stock || 0) - (product.reservedStock || 0));
    if (availableStock < quantity) {
      return next(new ErrorHandler(`Only ${availableStock} units available in stock`, 400));
    }

    const cart = await Cart.findOne({ user: userId }) as ICartDocument | null;
    if (!cart) return next(new ErrorHandler("Cart not found", 404));

    const itemIndex = cart.items.findIndex((item) => item.product.toString() === productId);
    if (itemIndex === -1) return next(new ErrorHandler("Item not in cart", 404));

    cart.items[itemIndex].quantity = quantity;
    await cart.save();

    const updatedCart = await cart.populate({
      path: "items.product",
      select: "name price discountPrice images coverImage stock reservedStock slug nursery isActive category isPublished isNurseryActive"
    });

    const enrichedCart = await enrichCartWithAvailability(updatedCart);
    res.status(200).json({ success: true, cart: enrichedCart });
  }
);

// 🔍 3. GET USER CART (Preserving State with Dynamic Availability Flags)
export const getMyCart = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    let cart = await Cart.findOne({ user: req.user?._id }).populate({
      path: "items.product",
      select: "name price discountPrice images coverImage stock reservedStock slug nursery isActive category isPublished isNurseryActive"
    });

    if (!cart) {
      cart = await Cart.create({ user: req.user?._id, items: [] });
    }

    // 🛡️ Dynamically enrich each item with isAvailable and unavailableReason flags.
    // Never deletes or removes items from the user's cart document in MongoDB.
    const enrichedCart = await enrichCartWithAvailability(cart);

    res.status(200).json({ success: true, cart: enrichedCart });
  }
);

// 🗑️ 4. REMOVE SINGLE ITEM FROM CART
export const removeFromCart = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { productId } = req.params;

    if (!productId) {
      return next(new ErrorHandler("Product ID is required", 400));
    }

    const cart = await Cart.findOne({ user: req.user?._id }) as ICartDocument | null;
    if (!cart) return next(new ErrorHandler("Cart not initialized", 404));

    cart.items = cart.items.filter(
      (item) => item.product.toString() !== productId
    ) as any;

    await cart.save();

    const updatedCart = await cart.populate({
      path: "items.product",
      select: "name price discountPrice images coverImage stock reservedStock slug nursery isActive category isPublished isNurseryActive"
    });

    const enrichedCart = await enrichCartWithAvailability(updatedCart);
    res.status(200).json({ success: true, message: "Item removed", cart: enrichedCart });
  }
);

// 🔄 5. LOCALSTORAGE HYBRID SYNC ENGINE
export const syncCart = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { guestCartItems } = req.body;
    const userId = req.user?._id;

    if (!Array.isArray(guestCartItems)) {
      return next(new ErrorHandler("Invalid payload format", 400));
    }

    let cart = await Cart.findOne({ user: userId }) as ICartDocument | null;
    if (!cart) cart = await Cart.create({ user: userId, items: [] }) as unknown as ICartDocument;

    for (const guestItem of guestCartItems) {
      const rawId =
        typeof guestItem.product === "object" && guestItem.product !== null
          ? (guestItem.product._id || guestItem.product.id)
          : (guestItem.product || guestItem.productId);
      const prodId = rawId ? String(rawId).trim() : null;
      if (!prodId) continue;

      const product = await Product.findById(prodId);
      if (!product) continue;

      const requestedQty = Math.max(1, Number(guestItem.quantity) || 1);
      const itemIndex = cart.items.findIndex(
        (item) => item.product && item.product.toString() === prodId
      );

      const availableStock = Math.max(0, (product.stock || 0) - (product.reservedStock || 0));

      if (itemIndex > -1) {
        const targetQty = cart.items[itemIndex].quantity + requestedQty;
        cart.items[itemIndex].quantity = targetQty <= availableStock ? targetQty : availableStock;
      } else {
        const targetQty = requestedQty <= availableStock ? requestedQty : availableStock;
        if (targetQty > 0) {
          cart.items.push({
            product: prodId as any,
            itemModel: resolveProductCommissionType(product),
            quantity: targetQty,
            nursery: product.nursery,
          });
        }
      }
    }

    await cart.save();
    const syncedCart = await cart.populate({
      path: "items.product",
      select: "name price discountPrice images coverImage stock reservedStock slug nursery isActive category isPublished isNurseryActive"
    });

    const enrichedCart = await enrichCartWithAvailability(syncedCart);
    res.status(200).json({ success: true, cart: enrichedCart });
  }
);


// 🧹 6. CLEAR ENTIRE CART
export const clearMyCart = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    let cart = await Cart.findOne({ user: req.user?._id }) as ICartDocument | null;

    if (!cart) {
      cart = await Cart.create({ user: req.user?._id, items: [] });
    } else {
      cart.items = [] as any;
      await cart.save();
    }

    res.status(200).json({ success: true, message: "Cart cleared successfully", cart });
  }
);