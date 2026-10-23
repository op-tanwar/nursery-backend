import { Request, Response, NextFunction } from "express";
import catchAsyncErrors from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/errorHandler";
import Cart from "../models/cartModel";
import NurseryProfile from "../models/nurseryProfileModel";
import { findProductAndModel } from "../utils/productRegistry";
import { ICartDocument } from "../types/cartWishlist.types";
import cacheManager from "../utils/cacheManager";

// 🛒 1. ADD OR INCREMENT ITEM IN CART
export const addToCart = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    const { productId, quantity } = req.body;
    const userId = req.user?._id;

    if (!productId || !quantity || quantity < 1) {
      return next(new ErrorHandler("Valid productId and quantity are required", 400));
    }

    const { product, modelName } = await findProductAndModel(productId);
    if (!product || !modelName) {
      return next(new ErrorHandler("Product not found in system catalogs", 404));
    }

    // 🛑 सुरक्षा चेक: चेक करें कि क्या इस प्रोडक्ट की नर्सरी एक्टिव है
    const nurseryProfile = await NurseryProfile.findOne({ nursery: product.nursery });
    if (nurseryProfile && !nurseryProfile.isActive) {
      return next(new ErrorHandler("This nursery is temporarily blocked by admin. Cannot add product.", 400));
    }

    let cart = await Cart.findOne({ user: userId }) as ICartDocument | null;

    if (!cart) {
      if (product.stock < quantity) {
        return next(new ErrorHandler(`Only ${product.stock} units available`, 400));
      }
      cart = await Cart.create({
        user: userId,
        items: [{ product: productId, itemModel: modelName, quantity, nursery: product.nursery }]
      }) as unknown as ICartDocument;
    } else {
      const itemIndex = cart.items.findIndex((item) => item.product.toString() === productId);

      if (itemIndex > -1) {
        const cumulativeQuantity = cart.items[itemIndex].quantity + quantity;
        if (product.stock < cumulativeQuantity) {
          return next(new ErrorHandler(`Max stock limit is ${product.stock}`, 400));
        }
        cart.items[itemIndex].quantity = cumulativeQuantity;
      } else {
        if (product.stock < quantity) {
          return next(new ErrorHandler(`Only ${product.stock} units available`, 400));
        }
        cart.items.push({ product: productId, itemModel: modelName, quantity, nursery: product.nursery });
      }
      await cart.save();
    }

    const updatedCart = await cart.populate({
      path: "items.product",
      select: "name price discountPrice images coverImage stock slug nursery"
    });

    res.status(200).json({ success: true, cart: updatedCart });
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

    const { product } = await findProductAndModel(productId);
    if (!product) return next(new ErrorHandler("Product not found", 404));

    // 🛑 सुरक्षा चेक: ब्लॉक की गई नर्सरी की क्वांटिटी अपडेट न करने दें
    const nurseryProfile = await NurseryProfile.findOne({ nursery: product.nursery });
    if (nurseryProfile && !nurseryProfile.isActive) {
      return next(new ErrorHandler("This product is currently unavailable due to nursery suspension.", 400));
    }

    if (product.stock < quantity) {
      return next(new ErrorHandler(`Only ${product.stock} units available in stock`, 400));
    }

    const cart = await Cart.findOne({ user: userId }) as ICartDocument | null;
    if (!cart) return next(new ErrorHandler("Cart not found", 404));

    const itemIndex = cart.items.findIndex((item) => item.product.toString() === productId);
    if (itemIndex === -1) return next(new ErrorHandler("Item not in cart", 404));

    cart.items[itemIndex].quantity = quantity;
    await cart.save();

    const updatedCart = await cart.populate({
      path: "items.product",
      select: "name price discountPrice images coverImage stock slug nursery"
    });

    res.status(200).json({ success: true, cart: updatedCart });
  }
);

// 🔍 3. GET USER CART (With Active Nursery Filtration)
export const getMyCart = catchAsyncErrors(
  async (req: Request, res: Response, next: NextFunction) => {
    let cart = await Cart.findOne({ user: req.user?._id }).populate({
      path: "items.product",
      select: "name price discountPrice images coverImage stock slug nursery"
    });

    if (!cart) {
      cart = await Cart.create({ user: req.user?._id, items: [] });
    } else if (cart.items.length > 0) {
      // 🛑 सुरक्षा चेक: उन सभी नर्सरी की लिस्ट निकालें जो Active हैं (Cached for performance)
      const activeNurseryIds = await cacheManager.getOrSet(
        "nurseries:active_ids_list",
        async () => {
          const activeNurseries = await NurseryProfile.find({ isActive: true }).select("nursery").lean();
          return activeNurseries.map((n) => n.nursery.toString());
        },
        300
      );

      // सिर्फ उन्हीं आइटम्स को कार्ट में रखें जिनकी नर्सरी एक्टिव है
      const originalLength = cart.items.length;
      cart.items = cart.items.filter((item: any) => {
        // अगर प्रोडक्ट पॉप्युलेट नहीं हुआ (डिलीट हो गया) या उसकी नर्सरी ब्लॉक है, तो हटा दें
        if (!item.product || !item.product.nursery) return false;
        return activeNurseryIds.includes(item.product.nursery.toString());
      }) as any;

      // अगर कोई आइटम फिल्टर होकर कम हुआ है, तो डेटाबेस में कार्ट को अपडेट कर दें
      if (cart.items.length !== originalLength) {
        await cart.save();
      }
    }

    res.status(200).json({ success: true, cart });
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
      select: "name price discountPrice images coverImage stock slug nursery"
    });

    res.status(200).json({ success: true, message: "Item removed", cart: updatedCart });
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

    // सिंक करने से पहले ही सभी एक्टिव नर्सरीज़ की लिस्ट ले लें
    const activeNurseries = await NurseryProfile.find({ isActive: true }).select("nursery").lean();
    const activeNurseryIds = activeNurseries.map(n => n.nursery.toString());

    for (const guestItem of guestCartItems) {
      const rawId =
        typeof guestItem.product === "object" && guestItem.product !== null
          ? (guestItem.product._id || guestItem.product.id)
          : (guestItem.product || guestItem.productId);
      const prodId = rawId ? String(rawId).trim() : null;
      if (!prodId) continue;

      const { product, modelName } = await findProductAndModel(prodId);
      if (!product || !modelName) continue;

      // 🛑 सुरक्षा चेक: अगर गेस्ट कार्ट का आइटम किसी ब्लॉक नर्सरी का है, तो उसे सिंक मत करो
      if (!activeNurseryIds.includes(product.nursery.toString())) continue;

      const requestedQty = Math.max(1, Number(guestItem.quantity) || 1);
      const itemIndex = cart.items.findIndex(
        (item) => item.product && item.product.toString() === prodId
      );

      if (itemIndex > -1) {
        const targetQty = cart.items[itemIndex].quantity + requestedQty;
        cart.items[itemIndex].quantity = targetQty <= product.stock ? targetQty : product.stock;
      } else {
        const targetQty = requestedQty <= product.stock ? requestedQty : product.stock;
        if (targetQty > 0) {
          cart.items.push({
            product: prodId as any,
            itemModel: modelName,
            quantity: targetQty,
            nursery: product.nursery,
          });
        }
      }
    }

    await cart.save();
    const syncedCart = await cart.populate({
      path: "items.product",
      select: "name price discountPrice images coverImage stock slug nursery"
    });

    if (syncedCart && Array.isArray(syncedCart.items)) {
      syncedCart.items = syncedCart.items.filter((item: any) => Boolean(item.product)) as any;
    }

    res.status(200).json({ success: true, cart: syncedCart });
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