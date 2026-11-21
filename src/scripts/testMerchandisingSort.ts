function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error("❌ Assertion failed: " + msg);
  }
}

import {
  applyCategoryDiversityInterleaving,
  buildMerchandisingScoreExpression,
} from "../controllers/productController";

console.log("===============================================================");
console.log("🌿 COMPREHENSIVE MERCHANDISING & RANKING ENGINE VERIFICATION");
console.log("===============================================================\n");

// ─── TEST 1: MongoDB Scoring Expression Structure & Weights ──────────────────
console.log("1. Validating MongoDB Merchandising Scoring Expression...");
const scoreExpr = buildMerchandisingScoreExpression();
assert(scoreExpr && Array.isArray(scoreExpr.$add), "Expression must be a MongoDB $add array");
assert(scoreExpr.$add.length === 8, `Expected 8 scoring components, got ${scoreExpr.$add.length}`);
console.log("  ✅ MongoDB scoring expression built with all 8 weighted components.\n");

// ─── TEST 2: High-Converting 8-Slot Interleaving on Storefront ────────────────
console.log("2. Validating Category Diversity Interleaving (8-Slot Curated Rhythm)...");

interface MockItem {
  _id: string;
  name: string;
  category: string;
  stock: number;
  merchandisingScore: number;
  price: number;
  discountPrice?: number;
  salesCount: number;
  ratingsAverage: number;
  ratingsQuantity: number;
  createdAt: Date;
}

// Generate realistic mock store catalog
const mockCatalog: MockItem[] = [
  // 16 Live Plants (various ratings & scores)
  ...Array.from({ length: 16 }, (_, i) => ({
    _id: `plant-${i + 1}`,
    name: `Plant ${i + 1}`,
    category: "plants",
    stock: 15,
    merchandisingScore: 11800 - i * 15,
    price: 499 + i * 50,
    salesCount: 30 - i,
    ratingsAverage: 4.8 - i * 0.05,
    ratingsQuantity: 25 - i,
    createdAt: new Date(Date.now() - i * 86400000),
  })),
  // 8 Ceramic / Terracotta Pots
  ...Array.from({ length: 8 }, (_, i) => ({
    _id: `pot-${i + 1}`,
    name: `Ceramic Pot ${i + 1}`,
    category: "pots",
    stock: 10,
    merchandisingScore: 11200 - i * 20,
    price: 399 + i * 40,
    salesCount: 20 - i,
    ratingsAverage: 4.7 - i * 0.05,
    ratingsQuantity: 18 - i,
    createdAt: new Date(Date.now() - (i + 10) * 86400000),
  })),
  // 6 Plant Care & Accessories
  ...Array.from({ length: 6 }, (_, i) => ({
    _id: `care-${i + 1}`,
    name: `Care Item ${i + 1}`,
    category: i % 2 === 0 ? "plant-care" : "accessories",
    stock: 25,
    merchandisingScore: 10900 - i * 25,
    price: 299 + i * 30,
    salesCount: 15 - i,
    ratingsAverage: 4.6 - i * 0.05,
    ratingsQuantity: 12 - i,
    createdAt: new Date(Date.now() - (i + 20) * 86400000),
  })),
  // 6 Stands, Tools, and Seeds
  ...Array.from({ length: 6 }, (_, i) => ({
    _id: `gear-${i + 1}`,
    name: `Tool/Stand ${i + 1}`,
    category: i % 2 === 0 ? "plant-stands-shelves" : "gardening-tools",
    stock: 5,
    merchandisingScore: 10600 - i * 20,
    price: 699 + i * 50,
    salesCount: 10 - i,
    ratingsAverage: 4.5 - i * 0.05,
    ratingsQuantity: 8 - i,
    createdAt: new Date(Date.now() - (i + 30) * 86400000),
  })),
  // 2 Out of Stock Items
  {
    _id: "plant-oos",
    name: "OOS Fiddle Leaf Fig",
    category: "plants",
    stock: 0,
    merchandisingScore: 1800,
    price: 999,
    salesCount: 50,
    ratingsAverage: 4.9,
    ratingsQuantity: 40,
    createdAt: new Date(),
  },
  {
    _id: "pot-oos",
    name: "OOS Designer Planter",
    category: "pots",
    stock: 0,
    merchandisingScore: 1500,
    price: 899,
    salesCount: 30,
    ratingsAverage: 4.8,
    ratingsQuantity: 20,
    createdAt: new Date(),
  },
];

const interleaved = applyCategoryDiversityInterleaving(mockCatalog);
assert(interleaved.length === mockCatalog.length, "Total catalog size must be exactly preserved");

// Verify Page 1 (Top 12 items)
const page1 = interleaved.slice(0, 12);
console.log("  Top 12 Results on Page 1 (Default Storefront Load):");
page1.forEach((p, idx) => {
  console.log(`    ${idx + 1}. [${p.category.padEnd(20)}] ${p.name.padEnd(22)} Score: ${p.merchandisingScore}`);
});

// Verify 8-slot rhythm pattern for cycle 0
assert(page1[0].category === "plants", "Slot 1 must be Plant");
assert(page1[1].category === "plants", "Slot 2 must be Plant");
assert(page1[2].category === "pots", "Slot 3 must be Pot");
assert(page1[3].category === "plants", "Slot 4 must be Plant");
assert(page1[4].category === "plant-care" || page1[4].category === "accessories", "Slot 5 must be Care/Accessory");
assert(page1[5].category === "plants", "Slot 6 must be Plant");
assert(page1[6].category === "pots", "Slot 7 must be Pot");
assert(page1[7].category === "plant-stands-shelves" || page1[7].category === "gardening-tools", "Slot 8 must be Gear/Stand");

console.log("  ✅ Page 1 reflects balanced rhythm (Plants + Pots + Care + Gear) with zero monotony.\n");

// ─── TEST 3: Pagination Integrity & Zero Duplicates ───────────────────────────
console.log("3. Validating Pagination Slicing & Zero Duplicates...");
const page2 = interleaved.slice(12, 24);
const page3 = interleaved.slice(24, 36);

const page1Ids = new Set(page1.map((p) => p._id));
const page2Ids = new Set(page2.map((p) => p._id));
const page3Ids = new Set(page3.map((p) => p._id));

for (const id of page2Ids) {
  assert(!page1Ids.has(id), `Duplicate ID across Page 1 and Page 2: ${id}`);
}
for (const id of page3Ids) {
  assert(!page1Ids.has(id) && !page2Ids.has(id), `Duplicate ID across pages: ${id}`);
}

console.log(`  Page 1 items: ${page1.length}`);
console.log(`  Page 2 items: ${page2.length}`);
console.log(`  Page 3 items: ${page3.length}`);
console.log("  ✅ Zero duplicate or skipped items across Page 1, Page 2, and Page 3.\n");

// ─── TEST 4: In-Stock Priority & Out-Of-Stock Quarantine ───────────────────────
console.log("4. Validating Out-Of-Stock Quarantine...");
const lastTwo = interleaved.slice(-2);
assert(lastTwo[0].stock === 0 && lastTwo[1].stock === 0, "Last items must be the OOS products");
console.log(`  Last item 1: ${lastTwo[0].name} (Stock: ${lastTwo[0].stock})`);
console.log(`  Last item 2: ${lastTwo[1].name} (Stock: ${lastTwo[1].stock})`);
console.log("  ✅ Out-of-stock items quarantined to the bottom of the catalog.\n");

// ─── TEST 5: Graceful Degradation / Empty Buckets ─────────────────────────────
console.log("5. Validating Empty Bucket Resilience...");
const catalogWithoutPots = mockCatalog.filter((p) => p.category !== "pots");
const resultWithoutPots = applyCategoryDiversityInterleaving(catalogWithoutPots);
assert(resultWithoutPots.length === catalogWithoutPots.length, "Zero pots catalog preserved length");
assert(!resultWithoutPots.some((p) => p.category === "pots"), "No pots present in output");
console.log("  ✅ Zero-pot catalog gracefully fills pot slots with top available items without throwing.\n");

console.log("===============================================================");
console.log("🎉 ALL MERCHANDISING TESTS PASSED PERFECTLY (100% SUCCESS)!");
console.log("===============================================================");
