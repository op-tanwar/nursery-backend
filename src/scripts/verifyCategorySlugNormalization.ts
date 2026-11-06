import {
  PRODUCT_CATEGORIES,
  CANONICAL_TAX_CATEGORIES,
  normalizeCategorySlug,
  normalizeTaxCategory,
} from "../constants/categories";
import Product, {
  PRODUCT_CATEGORIES as MODEL_PRODUCT_CATEGORIES,
} from "../models/productModel";
import { normalizeCategory } from "../controllers/productController";
import {
  SHOP_TYPE_TO_MODEL,
  CATEGORY_TO_MODEL_NAME,
} from "../utils/productRegistry";

async function runAudit() {
  console.log("===============================================================");
  console.log("🔬 STARTING END-TO-END CATEGORY SLUG NORMALIZATION AUDIT");
  console.log("===============================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, label: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${label}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${label}`);
      failed++;
    }
  }

  // 1. SSOT Category Constants Audit
  console.log("1️⃣ SSOT Category Constants & Slugs:");
  assert(
    PRODUCT_CATEGORIES.STANDS_SHELVES === "plant-stands-shelves",
    "PRODUCT_CATEGORIES.STANDS_SHELVES is canonical 'plant-stands-shelves'"
  );
  assert(
    (PRODUCT_CATEGORIES as any).LEGACY_STANDS_SHELVES === "stands-shelves",
    "PRODUCT_CATEGORIES.LEGACY_STANDS_SHELVES is 'stands-shelves'"
  );

  // 2. Slug Normalization Function Verification
  console.log("\n2️⃣ Slug Normalization Mapping Audit:");
  const testCases: Array<[string, string]> = [
    ["plant-stands-shelves", "plant-stands-shelves"],
    ["stands-shelves", "plant-stands-shelves"],
    ["plant-stands-and-shelves", "plant-stands-shelves"],
    ["Plant Stands", "plant-stands-shelves"],
    ["plant stands", "plant-stands-shelves"],
    ["PlantStandsShelves", "plant-stands-shelves"],
    ["plantstandsshelves", "plant-stands-shelves"],
    ["plants", "plants"],
    ["Plant", "plants"],
    ["pots", "pots"],
    ["pots-planters", "pots"],
    ["gardening-tools", "gardening-tools"],
    ["Gardening Tools", "gardening-tools"],
    ["plant-care", "plant-care"],
    ["Plant Care", "plant-care"],
    ["seeds-bulbs", "seeds-bulbs"],
    ["Seeds & Bulbs", "seeds-bulbs"],
    ["artificial-dried", "artificial-dried"],
  ];

  for (const [input, expected] of testCases) {
    const result = normalizeCategorySlug(input);
    assert(
      result === expected,
      `normalizeCategorySlug("${input}") => "${result}" (expected "${expected}")`
    );
  }

  // 3. Controller Normalization Audit
  console.log("\n3️⃣ Product Controller Category Normalization:");
  for (const [input, expected] of testCases) {
    const result = normalizeCategory(input);
    assert(
      result === expected,
      `normalizeCategory("${input}") => "${result}" (expected "${expected}")`
    );
  }

  // 4. Mongoose Model Enum & Validation
  console.log("\n4️⃣ Mongoose Product Model Enum & Pre-Validate Hook:");
  assert(
    MODEL_PRODUCT_CATEGORIES.includes("plant-stands-shelves" as any),
    "Product model enum includes 'plant-stands-shelves'"
  );
  assert(
    MODEL_PRODUCT_CATEGORIES.includes("stands-shelves" as any),
    "Product model enum includes 'stands-shelves' for backward compatibility"
  );

  // Test document pre-validate normalization
  const docWithLegacy = new Product({
    name: "Test Bamboo Stand",
    category: "stands-shelves",
    price: 999,
    stock: 5,
    description: "Multi tier bamboo plant stand for indoor and outdoor use.",
    nursery: "507f1f77bcf86cd799439011",
  });
  await docWithLegacy.validate();
  assert(
    docWithLegacy.category === "plant-stands-shelves",
    "Mongoose pre-validate hook automatically canonicalizes 'stands-shelves' to 'plant-stands-shelves'"
  );

  const docWithAnd = new Product({
    name: "Test Metal Stand",
    category: "plant-stands-and-shelves",
    price: 1499,
    stock: 10,
    description: "Heavy duty iron plant stand.",
    nursery: "507f1f77bcf86cd799439011",
  });
  await docWithAnd.validate();
  assert(
    docWithAnd.category === "plant-stands-shelves",
    "Mongoose pre-validate hook automatically canonicalizes 'plant-stands-and-shelves' to 'plant-stands-shelves'"
  );

  // 5. Tax Resolution Parity for Stands & Shelves
  console.log("\n5️⃣ Statutory GST Tax Resolution:");
  const taxMetaCanonical = normalizeTaxCategory("plant-stands-shelves");
  assert(
    taxMetaCanonical.taxPercentage === 18 && taxMetaCanonical.slug === "plant-stands-shelves",
    "Canonical 'plant-stands-shelves' resolves to 18% GST"
  );

  const taxMetaLegacy = normalizeTaxCategory("stands-shelves");
  assert(
    taxMetaLegacy.taxPercentage === 18 && taxMetaLegacy.slug === "plant-stands-shelves",
    "Legacy alias 'stands-shelves' resolves to canonical metadata with 18% GST"
  );

  const taxMetaAnd = normalizeTaxCategory("plant-stands-and-shelves");
  assert(
    taxMetaAnd.taxPercentage === 18 && taxMetaAnd.slug === "plant-stands-shelves",
    "Dashboard alias 'plant-stands-and-shelves' resolves to canonical metadata with 18% GST"
  );

  // 6. Polymorphic Model Registry Audit
  console.log("\n6️⃣ Polymorphic Model Registry:");
  assert(
    CATEGORY_TO_MODEL_NAME["plant-stands-shelves"] === "PlantStandsShelves",
    "CATEGORY_TO_MODEL_NAME['plant-stands-shelves'] -> 'PlantStandsShelves'"
  );
  assert(
    CATEGORY_TO_MODEL_NAME["stands-shelves"] === "PlantStandsShelves",
    "CATEGORY_TO_MODEL_NAME['stands-shelves'] -> 'PlantStandsShelves'"
  );
  assert(
    CATEGORY_TO_MODEL_NAME["plant-stands-and-shelves"] === "PlantStandsShelves",
    "CATEGORY_TO_MODEL_NAME['plant-stands-and-shelves'] -> 'PlantStandsShelves'"
  );
  assert(
    SHOP_TYPE_TO_MODEL["plant-stands-shelves"] === "PlantStandsShelves",
    "SHOP_TYPE_TO_MODEL['plant-stands-shelves'] -> 'PlantStandsShelves'"
  );

  console.log("\n===============================================================");
  console.log(`📊 AUDIT SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runAudit().catch((err) => {
  console.error("FATAL ERROR in audit:", err);
  process.exit(1);
});
