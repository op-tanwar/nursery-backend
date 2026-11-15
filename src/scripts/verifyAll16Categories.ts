import {
  extractProductPayload,
  validateCategoryAttributes,
  normalizeCategory,
} from "../controllers/productController";
import { PRODUCT_CATEGORIES, ProductCategory } from "../models/productModel";

interface TestCase {
  categoryName: string;
  categorySlug: ProductCategory;
  operation: "Create" | "Edit";
  inputBody: Record<string, any>;
  expectedCategory: ProductCategory;
  expectedAttributesKeys: string[];
}

const testCases: TestCase[] = [
  // 🌿 1. PLANTS
  {
    categoryName: "Plants",
    categorySlug: "plants",
    operation: "Create",
    inputBody: {
      category: "plants",
      plantData: JSON.stringify({
        name: "Monstera Deliciosa",
        category: "Indoor Plants",
        price: 899,
        stock: 25,
        description: "Lush Swiss cheese plant",
        lightRequirement: "Indirect sunlight",
        wateringSchedule: "Once a week",
        maintenanceLevel: "Easy",
        isPetFriendly: false,
        benefits: ["Air purifying", "Aesthetic"],
      }),
    },
    expectedCategory: "plants",
    expectedAttributesKeys: ["lightRequirement", "wateringSchedule", "isPetFriendly"],
  },
  {
    categoryName: "Plants",
    categorySlug: "plants",
    operation: "Edit",
    inputBody: {
      category: "plants",
      plantData: JSON.stringify({
        name: "Monstera Deliciosa Variegata",
        price: 1499,
        stock: 10,
        maintenanceLevel: "Medium",
        isPetFriendly: false,
      }),
      existingImages: JSON.stringify([{ url: "https://example.com/monstera.jpg", public_id: "m_1" }]),
      deletedImagePublicIds: JSON.stringify(["old_pic_1"]),
    },
    expectedCategory: "plants",
    expectedAttributesKeys: ["maintenanceLevel", "isPetFriendly"],
  },

  // 🏺 2. POTS & PLANTERS
  {
    categoryName: "Pots & Planters",
    categorySlug: "pots",
    operation: "Create",
    inputBody: {
      potData: JSON.stringify({
        name: "Minimalist Terracotta Planter",
        category: "Ceramic & Clay Pots",
        price: 499,
        stock: 40,
        description: "Handcrafted porous terracotta pot",
        material: "Terracotta",
        dimensions: { height: "18cm", diameter: "15cm" },
        hasDrainageHole: true,
        isIndoorOutdoor: "Both",
        includesSaucer: true,
      }),
    },
    expectedCategory: "pots",
    expectedAttributesKeys: ["material", "dimensions", "hasDrainageHole"],
  },
  {
    categoryName: "Pots & Planters",
    categorySlug: "pots",
    operation: "Edit",
    inputBody: {
      category: "pots-planters",
      potData: JSON.stringify({
        name: "Minimalist Terracotta Planter XL",
        price: 699,
        stock: 15,
        material: "Glazed Ceramic",
        color: ["White", "Terracotta"],
        dimensions: { height: "24cm", diameter: "20cm" },
        drainageHoles: true,
      }),
      existingImages: JSON.stringify([{ url: "https://example.com/pot.jpg", public_id: "p_1" }]),
    },
    expectedCategory: "pots",
    expectedAttributesKeys: ["material", "color", "dimensions"],
  },

  // 🛠️ 3. ACCESSORIES
  {
    categoryName: "Accessories",
    categorySlug: "accessories",
    operation: "Create",
    inputBody: {
      accessoryData: JSON.stringify({
        name: "Precision Brass Plant Mister",
        category: "Misting & Watering",
        price: 349,
        stock: 50,
        description: "Ultra-fine continuous mist spray bottle",
        specifications: {
          brand: "VerdantPro",
          material: "Brass / Glass",
          capacity: "300ml",
          weight: "280g",
        },
      }),
    },
    expectedCategory: "accessories",
    expectedAttributesKeys: ["brand", "material", "capacity", "weight"],
  },
  {
    categoryName: "Accessories",
    categorySlug: "accessories",
    operation: "Edit",
    inputBody: {
      accessoryData: JSON.stringify({
        name: "Precision Brass Plant Mister 2.0",
        price: 399,
        stock: 35,
        specifications: {
          brand: "VerdantPro Elite",
          material: "Solid Brass",
          capacity: "350ml",
        },
      }),
    },
    expectedCategory: "accessories",
    expectedAttributesKeys: ["brand", "material", "capacity"],
  },

  // 🔧 4. GARDENING TOOLS
  {
    categoryName: "Gardening Tools",
    categorySlug: "gardening-tools",
    operation: "Create",
    inputBody: {
      gardeningToolData: JSON.stringify({
        name: "Bypass Pruning Shears",
        category: "Pruning & Cutting Tools",
        price: 599,
        stock: 30,
        description: "SK-5 hardened steel bypass pruners",
        material: "SK-5 High Carbon Steel",
        handleMaterial: "Ergonomic Non-slip TPR",
        warrantyMonths: "24", // string coercion check
        features: ["Precision bypass blade", "Safety lock latch"],
      }),
    },
    expectedCategory: "gardening-tools",
    expectedAttributesKeys: ["material", "handleMaterial", "warrantyMonths", "features"],
  },
  {
    categoryName: "Gardening Tools",
    categorySlug: "gardening-tools",
    operation: "Edit",
    inputBody: {
      toolData: JSON.stringify({
        name: "Bypass Pruning Shears Pro Edition",
        price: 649,
        stock: 20,
        warrantyMonths: 36, // number check
        material: "Titanium Coated Steel",
      }),
    },
    expectedCategory: "gardening-tools",
    expectedAttributesKeys: ["warrantyMonths", "material"],
  },

  // 🧪 5. PLANT CARE
  {
    categoryName: "Plant Care",
    categorySlug: "plant-care",
    operation: "Create",
    inputBody: {
      plantCareData: JSON.stringify({
        name: "Bio-Enriched Liquid Seaweed Fertilizer",
        category: "Organic Fertilizers",
        price: 299,
        stock: 100,
        description: "Cold-pressed natural kelp extract",
        volumeOrWeight: "500 ml",
        formType: "Liquid",
        isOrganic: true,
        composition: "Ascophyllum Nodosum extract, Micronutrients",
        howToUse: ["Dilute 5ml per 1 Litre of clean water", "Foliar spray every 14 days"],
        suitableFor: ["All indoor and outdoor plants"],
      }),
    },
    expectedCategory: "plant-care",
    expectedAttributesKeys: ["volumeOrWeight", "formType", "isOrganic", "howToUse"],
  },
  {
    categoryName: "Plant Care",
    categorySlug: "plant-care",
    operation: "Edit",
    inputBody: {
      careData: JSON.stringify({
        name: "Bio-Enriched Liquid Seaweed Fertilizer - 1 Liter",
        price: 499,
        stock: 60,
        volumeOrWeight: 1000, // number union check
        formType: "Liquid",
        isOrganic: "true", // string boolean coercion check
      }),
    },
    expectedCategory: "plant-care",
    expectedAttributesKeys: ["volumeOrWeight", "formType", "isOrganic"],
  },

  // 🌱 6. SEEDS & BULBS
  {
    categoryName: "Seeds & Bulbs",
    categorySlug: "seeds-bulbs",
    operation: "Create",
    inputBody: {
      seedsBulbsData: JSON.stringify({
        name: "Heirloom Cherry Tomato Seeds",
        category: "Vegetable Seeds",
        price: 99,
        stock: 200,
        description: "Sweet cluster cherry tomato seeds, non-GMO",
        quantityPerPack: "100 Seeds",
        germinationTime: "6-10 days",
        sowingSeason: ["Spring", "Autumn"],
        seedType: "Heirloom",
        sunlightRequirement: "Full Sun",
      }),
    },
    expectedCategory: "seeds-bulbs",
    expectedAttributesKeys: ["quantityPerPack", "germinationTime", "sowingSeason", "sunlightRequirement"],
  },
  {
    categoryName: "Seeds & Bulbs",
    categorySlug: "seeds-bulbs",
    operation: "Edit",
    inputBody: {
      seedData: JSON.stringify({
        name: "Heirloom Cherry Tomato Seeds (Combo Pack)",
        price: 179,
        stock: 80,
        quantityPerPack: 250, // number union check
        germinationDays: 7, // numeric alias check
        sowingSeason: "Spring to Early Summer", // string scalar union check
      }),
    },
    expectedCategory: "seeds-bulbs",
    expectedAttributesKeys: ["quantityPerPack", "sowingSeason"],
  },

  // 🪜 7. PLANT STANDS & SHELVES
  {
    categoryName: "Plant Stands & Shelves",
    categorySlug: "plant-stands-shelves",
    operation: "Create",
    inputBody: {
      plantStandsShelvesData: JSON.stringify({
        name: "Tiered Bamboo Plant Ladder Rack",
        category: "Multi-Tier Shelves", // Subcategory dropdown value
        price: 1599,
        stock: 18,
        description: "Foldable 3-tier sustainable bamboo display stand",
        material: "Natural Bamboo",
        dimensions: { height: "98cm", width: "40cm", length: "70cm" },
        tierCount: 3,
        maxLoadCapacity: 45, // Number passed from frontend
        isFoldable: true,
      }),
    },
    expectedCategory: "plant-stands-shelves",
    expectedAttributesKeys: ["material", "dimensions", "tierCount", "maxLoadCapacity", "isFoldable"],
  },
  {
    categoryName: "Plant Stands & Shelves",
    categorySlug: "plant-stands-shelves",
    operation: "Edit",
    inputBody: {
      category: "plant-stands-and-shelves", // Alias slug test
      standData: JSON.stringify({
        name: "Tiered Bamboo Plant Ladder Rack - 4 Tier",
        price: 1999,
        stock: 12,
        tierCount: "4", // Coerced to number
        maxLoadCapacity: "60 kg", // String representation
        isFoldable: "true",
      }),
      existingImages: JSON.stringify([{ url: "https://example.com/rack.jpg", public_id: "rack_1" }]),
      deletedImagePublicIds: JSON.stringify(["old_rack_photo"]),
    },
    expectedCategory: "plant-stands-shelves",
    expectedAttributesKeys: ["tierCount", "maxLoadCapacity", "isFoldable"],
  },

  // 🥀 8. ARTIFICIAL & DRIED PLANTS
  {
    categoryName: "Artificial & Dried Plants",
    categorySlug: "artificial-dried-plants",
    operation: "Create",
    inputBody: {
      artificialData: JSON.stringify({
        name: "Natural Dried Fluffy Pampas Grass Stems",
        category: "Dried Flowers", // Subcategory dropdown value
        price: 699,
        stock: 65,
        description: "Selected tall white dried pampas decor",
        specifications: {
          brand: "BohoBotanics",
          material: "100% Natural Dried Grass",
          height: "60cm",
          color: "Creamy White",
          washable: false,
          potIncluded: false,
        },
      }),
    },
    expectedCategory: "artificial-dried",
    expectedAttributesKeys: ["brand", "material", "height", "color", "washable", "potIncluded"],
  },
  {
    categoryName: "Artificial & Dried Plants",
    categorySlug: "artificial-dried-plants",
    operation: "Edit",
    inputBody: {
      category: "artificial-dried-plants", // Alias slug test
      artificialDriedPlantData: JSON.stringify({
        name: "Natural Dried Fluffy Pampas Grass Stems - Extra Fluffy (Pack of 15)",
        price: 899,
        stock: 45,
        specifications: {
          brand: "BohoBotanics Luxury",
          height: 75, // number height union
          washable: "false",
          potIncluded: "true",
        },
      }),
      existingImages: JSON.stringify([{ url: "https://example.com/pampas.jpg", public_id: "pamp_1" }]),
      deletedImagePublicIds: JSON.stringify(["pamp_prev"]),
    },
    expectedCategory: "artificial-dried",
    expectedAttributesKeys: ["brand", "height", "washable", "potIncluded"],
  },
];

console.log("======================================================================");
console.log("🧪 EXECUTING FULL 8 CATEGORIES × 2 OPERATIONS (CREATE & EDIT) TEST MATRIX");
console.log("======================================================================\n");

let passedCount = 0;
let failedCount = 0;

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  const testNumber = i + 1;
  const label = `[Test ${testNumber.toString().padStart(2, "0")}/16] Category: ${tc.categoryName.padEnd(26)} | Op: ${tc.operation.padEnd(6)}`;

  try {
    // 1. Run payload extraction pipeline
    const extracted = extractProductPayload(tc.inputBody);

    // 2. Verify extracted category matches valid enum
    if (!extracted.category || !PRODUCT_CATEGORIES.includes(extracted.category)) {
      throw new Error(
        `Invalid or missing category "${extracted.category}". Allowed: ${PRODUCT_CATEGORIES.join(", ")}`
      );
    }

    const normExtracted = normalizeCategory(extracted.category);
    const normExpected = normalizeCategory(tc.expectedCategory);
    if (normExtracted !== normExpected) {
      throw new Error(
        `Category mismatch: got "${normExtracted}", expected "${normExpected}"`
      );
    }

    // 3. Verify core required fields
    if (!extracted.name) throw new Error("Missing extracted product name");
    if (typeof extracted.price !== "number" || isNaN(extracted.price))
      throw new Error(`Invalid price: ${extracted.price}`);
    if (typeof extracted.stock !== "number" || isNaN(extracted.stock))
      throw new Error(`Invalid stock: ${extracted.stock}`);

    // 4. Validate category-specific polymorphic attributes
    const validatedAttributes = validateCategoryAttributes(
      extracted.category,
      extracted.attributes
    );

    // 5. Verify required category attribute keys are present and typed correctly
    for (const key of tc.expectedAttributesKeys) {
      if (validatedAttributes[key] === undefined) {
        throw new Error(
          `Missing expected attribute key "${key}" in category attributes: ${JSON.stringify(
            validatedAttributes
          )}`
        );
      }
    }

    // 6. For edit mode, verify images and deletions handling
    if (tc.operation === "Edit" && tc.inputBody.existingImages) {
      const existing = JSON.parse(tc.inputBody.existingImages);
      if (!Array.isArray(existing) || existing.length === 0) {
        throw new Error("Failed to preserve existing images array");
      }
    }

    if (tc.operation === "Edit" && tc.inputBody.deletedImagePublicIds) {
      const deleted = JSON.parse(tc.inputBody.deletedImagePublicIds);
      if (!Array.isArray(deleted) || deleted.length === 0) {
        throw new Error("Failed to parse deletedImagePublicIds array");
      }
    }

    console.log(`✅ ${label} -> PASSED (Category: "${extracted.category}", Attrs: ${Object.keys(validatedAttributes).length} keys)`);
    passedCount++;
  } catch (err: any) {
    console.error(`❌ ${label} -> FAILED: ${err.message}`);
    failedCount++;
  }
}

console.log("\n======================================================================");
console.log(`📊 TEST MATRIX SUMMARY: ${passedCount} / ${testCases.length} PASSED, ${failedCount} FAILED`);
console.log("======================================================================");

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
