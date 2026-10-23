/**
 * ======================================================================
 * 💰 PRICE INTEGRITY & DYNAMIC CATEGORY TAX (GST) ENGINE
 * ======================================================================
 * Authoritative single-source-of-truth for Urban Nursery pricing,
 * dynamic category-wise GST, shipping, and paise-level currency math.
 * 
 * Rules:
 * 1. Zero Trust on client-submitted prices or totals.
 * 2. Effective Price = (discountPrice > 0 && discountPrice < originalPrice) ? discountPrice : originalPrice.
 * 3. Discount Price must be non-negative and strictly less than original price.
 * 4. All math is performed in integer PAISE (1 INR = 100 Paise) to eliminate
 *    JavaScript IEEE-754 floating-point drift.
 * 5. Dynamic Category-Wise GST: Each line item calculates its tax according to its
 *    assigned category tax rate and tax-inclusive/exclusive setting.
 * ======================================================================
 */

export const toPaise = (rupees: number): number => {
  return Math.round(Number(rupees || 0) * 100);
};

export const toRupees = (paise: number): number => {
  return Math.round(Number(paise || 0)) / 100;
};

export const roundMoney = (rupees: number): number => {
  return toRupees(toPaise(rupees));
};

export const getEffectivePrice = (
  originalPrice: number,
  discountPrice?: number | null
): number => {
  const orig = Number(originalPrice) || 0;
  const disc = Number(discountPrice);

  if (!isNaN(disc) && disc > 0 && disc < orig) {
    return roundMoney(disc);
  }
  return roundMoney(orig);
};

export interface ItemTaxCalculation {
  lineGross: number;
  taxableAmount: number;
  taxAmount: number;
  taxRatePercentage: number;
  taxCategory: string;
  isTaxInclusive: boolean;
}

/**
 * Calculates GST for an individual product line item with paise precision.
 */
export const calculateItemTax = (
  effectivePrice: number,
  quantity: number,
  taxConfig?: {
    category?: string;
    taxPercentage?: number;
    isTaxInclusive?: boolean;
  }
): ItemTaxCalculation => {
  const qty = Math.max(1, Number(quantity) || 1);
  const effPrice = roundMoney(effectivePrice);
  const lineGrossPaise = toPaise(effPrice) * qty;

  const taxPercentage = Math.max(0, Math.min(100, Number(taxConfig?.taxPercentage ?? 18)));
  const isTaxInclusive = Boolean(taxConfig?.isTaxInclusive);
  const taxCategory = taxConfig?.category || "General";

  let taxPaise = 0;
  let taxableAmountPaise = 0;

  if (taxPercentage === 0) {
    taxPaise = 0;
    taxableAmountPaise = lineGrossPaise;
  } else if (isTaxInclusive) {
    // Inclusive: Tax = Price - (Price / (1 + Rate))
    taxPaise = Math.round(lineGrossPaise * (taxPercentage / (100 + taxPercentage)));
    taxableAmountPaise = lineGrossPaise - taxPaise;
  } else {
    // Exclusive: Tax = Price * Rate
    taxableAmountPaise = lineGrossPaise;
    taxPaise = Math.round(lineGrossPaise * (taxPercentage / 100));
  }

  return {
    lineGross: toRupees(lineGrossPaise),
    taxableAmount: toRupees(taxableAmountPaise),
    taxAmount: toRupees(taxPaise),
    taxRatePercentage: taxPercentage,
    taxCategory,
    isTaxInclusive,
  };
};

export const calculateServerShippingAndTax = (itemsPrice: number): { shippingPrice: number; taxPrice: number } => {
  const itemsPricePaise = toPaise(itemsPrice);
  const shippingPricePaise = itemsPricePaise >= 50000 || itemsPricePaise === 0 ? 0 : 5000;
  const taxPricePaise = Math.round(itemsPricePaise * 0.18);

  return {
    shippingPrice: toRupees(shippingPricePaise),
    taxPrice: toRupees(taxPricePaise),
  };
};

export interface CategoryTaxSummary {
  category: string;
  taxRate: number;
  taxableAmount: number;
  taxAmount: number;
  isTaxInclusive: boolean;
}

export interface AuthoritativeTotals {
  originalItemsPrice: number;
  discountAmount: number;
  itemsPrice: number;
  shippingPrice: number;
  taxPrice: number;
  totalPrice: number;
  totalPricePaise: number;
  categoryTaxBreakdown: CategoryTaxSummary[];
  itemTaxSnapshots: ItemTaxCalculation[];
}

/**
 * Authoritatively compute full order financial breakdown from fresh catalog items
 * with dynamic category-wise GST configuration.
 */
export const calculateAuthoritativeTotals = (
  items: Array<{
    price: number;
    discountPrice?: number | null;
    quantity: number;
    itemModel?: string;
    modelName?: string;
    category?: string;
    isTaxInclusive?: boolean;
  }>,
  taxMap?: Record<string, { category: string; itemModel?: string; taxPercentage: number; isTaxInclusive: boolean }>
): AuthoritativeTotals => {
  let originalItemsPricePaise = 0;
  let itemsPricePaise = 0;
  let totalTaxPaise = 0;
  let extraExclusiveTaxPaise = 0;

  const categoryAccumulator: Record<
    string,
    { category: string; taxRate: number; taxableAmountPaise: number; taxAmountPaise: number; isTaxInclusive: boolean }
  > = {};
  const itemTaxSnapshots: ItemTaxCalculation[] = [];

  for (const item of items) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const origPrice = Number(item.price) || 0;
    const effPrice = getEffectivePrice(origPrice, item.discountPrice);

    originalItemsPricePaise += toPaise(origPrice) * qty;
    itemsPricePaise += toPaise(effPrice) * qty;

    // Resolve tax configuration by itemModel, modelName, or category
    const modelKey = item.itemModel || item.modelName || "";
    const catKey = item.category || "";

    // 1. Direct match by exact or lowercase key
    let taxConfig =
      taxMap &&
      (taxMap[modelKey] ||
        taxMap[catKey] ||
        taxMap[modelKey.toLowerCase()] ||
        taxMap[catKey.toLowerCase()]);

    // 2. Intelligent keyword match (e.g., "Indoor Plants" -> "Plants", "Ceramic Pots" -> "Pots")
    if (!taxConfig && taxMap) {
      const lowerCat = catKey.toLowerCase();
      const lowerModel = modelKey.toLowerCase();
      for (const [key, conf] of Object.entries(taxMap)) {
        const lowerKey = key.toLowerCase();
        if (
          (lowerCat && (lowerCat.includes(lowerKey) || lowerKey.includes(lowerCat))) ||
          (lowerModel && (lowerModel.includes(lowerKey) || lowerKey.includes(lowerModel)))
        ) {
          taxConfig = conf;
          break;
        }
      }
    }

    // 3. Fallback to statutory default (18% exclusive)
    if (!taxConfig) {
      taxConfig = {
        category: catKey || modelKey || "General",
        taxPercentage: 18,
        isTaxInclusive: false,
      };
    }

    // Allow explicit item-level isTaxInclusive override if present
    if (typeof item.isTaxInclusive === "boolean") {
      taxConfig = { ...taxConfig, isTaxInclusive: item.isTaxInclusive };
    }

    const itemTax = calculateItemTax(effPrice, qty, taxConfig);
    itemTaxSnapshots.push(itemTax);

    const lineTaxPaise = toPaise(itemTax.taxAmount);
    totalTaxPaise += lineTaxPaise;

    if (!itemTax.isTaxInclusive) {
      extraExclusiveTaxPaise += lineTaxPaise;
    }

    // Accumulate category-wise breakdown
    const groupKey = itemTax.taxCategory;
    if (!categoryAccumulator[groupKey]) {
      categoryAccumulator[groupKey] = {
        category: groupKey,
        taxRate: itemTax.taxRatePercentage,
        taxableAmountPaise: 0,
        taxAmountPaise: 0,
        isTaxInclusive: itemTax.isTaxInclusive,
      };
    }
    categoryAccumulator[groupKey].taxableAmountPaise += toPaise(itemTax.taxableAmount);
    categoryAccumulator[groupKey].taxAmountPaise += lineTaxPaise;
  }

  const discountAmountPaise = Math.max(0, originalItemsPricePaise - itemsPricePaise);
  const itemsPrice = toRupees(itemsPricePaise);

  // Delivery calculation: Free shipping threshold at ₹500
  const shippingPricePaise = itemsPricePaise >= 50000 || itemsPricePaise === 0 ? 0 : 5000;
  const shippingPrice = toRupees(shippingPricePaise);

  const taxPrice = toRupees(totalTaxPaise);

  // Final total: itemsPrice (which contains inclusive tax) + exclusiveTax + shipping
  const totalPricePaise = itemsPricePaise + extraExclusiveTaxPaise + shippingPricePaise;
  const totalPrice = toRupees(totalPricePaise);

  const categoryTaxBreakdown: CategoryTaxSummary[] = Object.values(categoryAccumulator).map((acc) => ({
    category: acc.category,
    taxRate: acc.taxRate,
    taxableAmount: toRupees(acc.taxableAmountPaise),
    taxAmount: toRupees(acc.taxAmountPaise),
    isTaxInclusive: acc.isTaxInclusive,
  }));

  return {
    originalItemsPrice: toRupees(originalItemsPricePaise),
    discountAmount: toRupees(discountAmountPaise),
    itemsPrice,
    shippingPrice,
    taxPrice,
    totalPrice,
    totalPricePaise,
    categoryTaxBreakdown,
    itemTaxSnapshots,
  };
};
