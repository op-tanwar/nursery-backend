import { Request, Response, NextFunction } from "express";
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

// ======================================================================
// ⚡ CENTRALIZED CACHE CONSTANTS & INVALIDATION UTILITIES
// ======================================================================

/**
 * Global cache key for active nursery vendor user IDs (5-minute TTL)
 */
export const ACTIVE_NURSERIES_CACHE_KEY = "nurseries:active_ids_list";

/**
 * ⚡ Fetch cached active and approved nursery user and profile IDs
 * Returns both NurseryProfile._id and User._id strings for complete consistency
 * across product references and user accounts.
 */
export const getActiveNurseryIds = async (): Promise<string[]> => {
  return cacheManager.getOrSet(
    ACTIVE_NURSERIES_CACHE_KEY,
    async () => {
      // 1. Fetch active profiles (excluding explicitly rejected or deactivated profiles)
      const activeNurseries = await NurseryProfile.find({
        isActive: { $ne: false },
        approvalStatus: { $ne: "Rejected" },
      })
        .select("nursery _id")
        .lean();

      const ids = new Set<string>();
      activeNurseries.forEach((n) => {
        if (n._id) ids.add(n._id.toString());
        if (n.nursery) ids.add(n.nursery.toString());
      });

      // 2. Fetch active users with nursery vendor role
      const activeUsers = await User.find({
        role: "nursery",
        isActive: { $ne: false },
        isBlocked: { $ne: true },
        status: { $nin: ["Blocked", "Suspended"] },
      })
        .select("_id")
        .lean();

      activeUsers.forEach((u) => {
        if (u._id) ids.add(u._id.toString());
      });

      return Array.from(ids);
    },
    300 // 5 Minutes TTL
  );
};

/**
 * 🧹 Invalidate all active nursery ID caches and nursery-specific profile caches
 * Clears both exact keys and pattern namespaces (nurseries:* and nursery:*)
 */
export const invalidateNurseryCache = async (nurseryId?: string): Promise<void> => {
  const keysToDelete = [
    ACTIVE_NURSERIES_CACHE_KEY,
    "nurseries:active_ids",
  ];

  if (nurseryId) {
    const idStr = nurseryId.toString();
    keysToDelete.push(
      `nursery:${idStr}`,
      `nursery_profile:${idStr}`,
      `pname:nursery:${idStr}`
    );
  }

  await Promise.all(keysToDelete.map((key) => cacheManager.del(key)));

  await Promise.all([
    cacheManager.invalidatePattern("nurseries:"),
    nurseryId
      ? cacheManager.invalidatePattern(`nursery:${nurseryId}:`)
      : cacheManager.invalidatePattern("nursery:"),
  ]);
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

  // 1. Collect unique nursery IDs from cart items
  const uniqueNurseryIds: string[] = Array.from(
    new Set(
      rawItems
        .map((item: any) => item.nursery?.toString() || item.product?.nursery?.toString())
        .filter((id: any): id is string => Boolean(id))
    )
  );

  // 2. Fetch cached active nursery IDs, nursery profiles, & user statuses in parallel
  const [activeNurseryIds, nurseryProfiles, nurseryUsers] = await Promise.all([
    getActiveNurseryIds(),
    uniqueNurseryIds.length > 0
      ? NurseryProfile.find({
          $or: [
            { nursery: { $in: uniqueNurseryIds as any } },
            { _id: { $in: uniqueNurseryIds as any } },
          ],
        })
          .select("nursery _id isActive approvalStatus businessName")
          .lean()
      : [],
    uniqueNurseryIds.length > 0
      ? User.find({ _id: { $in: uniqueNurseryIds as any } })
          .select("_id isActive isBlocked status")
          .lean()
      : [],
  ]);

  const profileMap = new Map<string, any>();
  for (const np of nurseryProfiles) {
    if (np.nursery) {
      profileMap.set(np.nursery.toString(), np);
    }
    if (np._id) {
      profileMap.set(np._id.toString(), np);
    }
  }

  const userMap = new Map<string, any>();
  for (const u of nurseryUsers) {
    userMap.set(u._id.toString(), u);
  }

  const isNurseryActive = (nurseryId?: string | null): boolean => {
    if (!nurseryId) return true; // Direct platform product
    if (!activeNurseryIds.includes(nurseryId)) {
      return false;
    }
    const profile = profileMap.get(nurseryId);
    const userId = profile?.nursery ? profile.nursery.toString() : nurseryId;
    const userDoc = userMap.get(userId);

    if (profile && profile.isActive === false) {
      return false;
    }

    if (userDoc) {
      if (userDoc.isActive === false || userDoc.isBlocked === true) {
        return false;
      }
      if (userDoc.status === "Blocked" || userDoc.status === "Suspended") {
        return false;
      }
    }

    return true;
  };

  // 3. Dynamically evaluate availability and compute subtotal excluding unavailable items
  let subtotal = 0;
  let availableItemsCount = 0;
  let unavailableItemsCount = 0;

  const enrichedItems: IEnrichedCartItem[] = rawItems.map((rawItem: any) => {
    const product = rawItem.product;

    let isAvailable = true;
    let unavailableReason: UnavailableReason | undefined = undefined;

    const nurseryId = rawItem.nursery?.toString() || product?.nursery?.toString();
    const profile = profileMap.get(nurseryId);
    const nurseryName = profile?.businessName || "Urban Nursery";

    if (!product || product.isActive === false || product.isPublished === false) {
      isAvailable = false;
      unavailableReason = "PRODUCT_DISABLED";
    } else {
      if (!isNurseryActive(nurseryId)) {
        isAvailable = false;
        unavailableReason = "NURSERY_INACTIVE";
      } else {
        const availableStock = Math.max(0, (product.stock || 0) - (product.reservedStock || 0));
        if (availableStock <= 0) {
          isAvailable = false;
          unavailableReason = "OUT_OF_STOCK";
        }
      }
    }

    if (isAvailable && product) {
      const price =
        product.discountPrice != null && product.discountPrice > 0
          ? product.discountPrice
          : (product.price || 0);
      subtotal += price * (rawItem.quantity || 1);
      availableItemsCount += rawItem.quantity || 1;
    } else {
      unavailableItemsCount += rawItem.quantity || 1;
    }

    return {
      ...rawItem,
      nurseryName,
      isAvailable,
      unavailableReason,
    };
  });

  return {
    ...cartObj,
    items: enrichedItems,
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
    select: "name price discountPrice stock nursery isActive",
  });

  if (!cart || !cart.items || cart.items.length === 0) {
    return { isValid: true, unavailableItems: [] };
  }

  const enriched = await enrichCartWithAvailability(cart);
  const unavailableList = enriched.items
    .filter((it) => it.isAvailable === false)
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
        items: [{ product: productId, itemModel: "Product", quantity, nursery: product.nursery }]
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
        cart.items.push({ product: productId, itemModel: "Product", quantity, nursery: product.nursery });
      }
      await cart.save();
    }

    const updatedCart = await cart.populate({
      path: "items.product",
      select: "name price discountPrice images coverImage stock reservedStock slug nursery isActive category isPublished"
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
      select: "name price discountPrice images coverImage stock reservedStock slug nursery isActive category isPublished"
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
      select: "name price discountPrice images coverImage stock reservedStock slug nursery isActive category isPublished"
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
      select: "name price discountPrice images coverImage stock reservedStock slug nursery isActive category isPublished"
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
            itemModel: "Product",
            quantity: targetQty,
            nursery: product.nursery,
          });
        }
      }
    }

    await cart.save();
    const syncedCart = await cart.populate({
      path: "items.product",
      select: "name price discountPrice images coverImage stock reservedStock slug nursery isActive category isPublished"
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