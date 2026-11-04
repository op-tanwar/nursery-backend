/**
 * 🚀 PRODUCTION DATABASE MIGRATION SCRIPT
 * Migrates 8 legacy catalog collections into the unified, polymorphic Product collection.
 *
 * Usage:
 *   npx ts-node src/scripts/migrateCatalogToUnifiedProduct.ts
 *   npx ts-node src/scripts/migrateCatalogToUnifiedProduct.ts --dry-run
 */

import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import mongoose from "mongoose";

// Load environment variables
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

import Product, { ProductCategory } from "../models/productModel";

const getLegacyModel = (name: string, collection: string) => {
  if (mongoose.models[name]) return mongoose.models[name];
  return mongoose.model(name, new mongoose.Schema({}, { strict: false, collection }));
};

const isDryRun = process.argv.includes("--dry-run");

interface LegacyMappingConfig {
  sourceName: string;
  category: ProductCategory;
  model: mongoose.Model<any>;
  extractAttributes: (doc: any) => Record<string, any>;
}

const CATALOG_MAPPINGS: LegacyMappingConfig[] = [
  {
    sourceName: "Plant",
    category: "plants",
    model: getLegacyModel("Plant", "plants"),
    extractAttributes: (doc) => ({
      lightRequirement: doc.lightRequirement,
      wateringSchedule: doc.wateringSchedule,
      maintenanceLevel: doc.maintenanceLevel,
      isPetFriendly: doc.isPetFriendly,
      benefits: doc.benefits || [],
      careInstructions: doc.careInstructions || [],
      plantType: doc.plantType || (doc.category !== "plants" ? doc.category : undefined),
    }),
  },
  {
    sourceName: "Pot",
    category: "pots",
    model: getLegacyModel("Pot", "pots"),
    extractAttributes: (doc) => ({
      material: doc.material,
      color: doc.color,
      dimensions: doc.dimensions,
      drainageHoles: doc.drainageHoles,
      shape: doc.shape,
    }),
  },
  {
    sourceName: "Accessory",
    category: "accessories",
    model: getLegacyModel("Accessory", "accessories"),
    extractAttributes: (doc) => ({
      specifications: doc.specifications,
      material: doc.specifications?.material || doc.material,
      brand: doc.specifications?.brand || doc.brand,
      weight: doc.specifications?.weight || doc.weight,
      capacity: doc.specifications?.capacity || doc.capacity,
    }),
  },
  {
    sourceName: "GardeningTool",
    category: "gardening-tools",
    model: getLegacyModel("GardeningTool", "gardeningtools"),
    extractAttributes: (doc) => ({
      features: doc.features || [],
      material: doc.material,
      handleMaterial: doc.handleMaterial,
      warrantyMonths: doc.warrantyMonths,
    }),
  },
  {
    sourceName: "PlantCare",
    category: "plant-care",
    model: getLegacyModel("PlantCare", "plantcares"),
    extractAttributes: (doc) => ({
      composition: doc.composition,
      howToUse: doc.howToUse || [],
      volumeOrWeight: doc.volumeOrWeight,
      formType: doc.formType,
      suitableFor: doc.suitableFor || [],
    }),
  },
  {
    sourceName: "SeedsBulbs",
    category: "seeds-bulbs",
    model: getLegacyModel("SeedsBulbs", "seedsbulbs"),
    extractAttributes: (doc) => ({
      sowingSeason: doc.sowingSeason || [],
      germinationTime: doc.germinationTime,
      quantityPerPack: doc.quantityPerPack,
    }),
  },
  {
    sourceName: "PlantStandsShelves",
    category: "stands-shelves",
    model: getLegacyModel("PlantStandsShelves", "plantstandsshelves"),
    extractAttributes: (doc) => ({
      material: doc.material,
      dimensions: doc.dimensions,
      tierCount: doc.tierCount,
      maxLoadCapacity: doc.maxLoadCapacity,
    }),
  },
  {
    sourceName: "ArtificialDriedPlant",
    category: "artificial-dried",
    model: getLegacyModel("ArtificialDriedPlant", "artificialdriedplants"),
    extractAttributes: (doc) => ({
      specifications: doc.specifications,
      material: doc.specifications?.material || doc.material,
      height: doc.specifications?.height || doc.height,
      color: doc.specifications?.color || doc.color,
      brand: doc.specifications?.brand || doc.brand,
    }),
  },
];

const migrate = async () => {
  const startTime = Date.now();
  console.log("===============================================================");
  console.log("🚀 STARTING UNIFIED PRODUCT CATALOG MIGRATION");
  console.log(`Mode: ${isDryRun ? "DRY-RUN (Simulated - No Database Writes)" : "LIVE MIGRATION"}`);
  console.log("===============================================================");

  const dbUri = process.env.DB_URI;
  if (!dbUri) {
    throw new Error("Missing DB_URI in environment configuration.");
  }

  await mongoose.connect(dbUri);
  console.log("🍃 MongoDB connection established.");

  const summary = {
    totalScanned: 0,
    totalMigrated: 0,
    totalFailed: 0,
    byCategory: {} as Record<string, { scanned: number; migrated: number; failed: number }>,
  };

  const BATCH_SIZE = 150;

  for (const config of CATALOG_MAPPINGS) {
    const { sourceName, category, model, extractAttributes } = config;
    summary.byCategory[category] = { scanned: 0, migrated: 0, failed: 0 };

    console.log(`\n⏳ Scanning collection for ${sourceName} (${category})...`);

    try {
      const cursor = model.find({}).lean().cursor();
      let batch: any[] = [];

      for await (const doc of cursor) {
        summary.totalScanned++;
        summary.byCategory[category].scanned++;

        try {
          // Normalize cover image & gallery
          const rawImages: any[] = doc.images || [];
          const images = rawImages.map((img: any) => ({
            url: typeof img === "string" ? img : img.url,
            public_id: img.public_id || `legacy_${doc._id}_${Math.random().toString(36).substring(2, 6)}`,
          }));

          const coverImage = doc.coverImage
            ? {
                url: typeof doc.coverImage === "string" ? doc.coverImage : doc.coverImage.url,
                public_id: doc.coverImage.public_id || images[0]?.public_id || `legacy_cover_${doc._id}`,
              }
            : images[0];

          // Extract polymorphic category attributes
          const attributes = extractAttributes(doc);

          // Build unified document payload
          const unifiedDoc: any = {
            _id: doc._id, // Preserve historical ObjectID for order & checkout references
            name: doc.name || "Unnamed Product",
            slug: doc.slug,
            slugHistory: doc.slugHistory || [],
            category,
            nursery: doc.nursery,
            price: Number(doc.price) || 0,
            discountPrice: Number(doc.discountPrice) || 0,
            stock: Number(doc.stock) || 0,
            reservedStock: Number(doc.reservedStock) || 0,
            description: doc.description || doc.descriptionOption?.short || "No description provided.",
            descriptionOption: doc.descriptionOption || undefined,
            coverImage,
            images,
            isPublished: doc.isActive !== false && doc.isPublished !== false,
            isActive: doc.isActive !== false && doc.isPublished !== false,
            ratingsAverage: Number(doc.ratingsAverage || doc.ratings) || 0,
            ratingsQuantity: Number(doc.ratingsQuantity || doc.numOfReviews) || 0,
            ratings: Number(doc.ratings || doc.ratingsAverage) || 0,
            numOfReviews: Number(doc.numOfReviews || doc.ratingsQuantity) || 0,
            reviews: doc.reviews || [],
            metaTitle: doc.metaTitle || undefined,
            metaDescription: doc.metaDescription || undefined,
            tags: doc.tags || [],
            attributes,
            createdAt: doc.createdAt || new Date(),
            updatedAt: doc.updatedAt || new Date(),
          };

          batch.push({
            updateOne: {
              filter: { _id: doc._id },
              update: { $set: unifiedDoc },
              upsert: true,
            },
          });

          if (batch.length >= BATCH_SIZE) {
            if (!isDryRun) {
              await Product.bulkWrite(batch, { ordered: false });
            }
            summary.totalMigrated += batch.length;
            summary.byCategory[category].migrated += batch.length;
            console.log(`   Migrated ${summary.byCategory[category].migrated} items...`);
            batch = [];
          }
        } catch (itemErr: any) {
          summary.totalFailed++;
          summary.byCategory[category].failed++;
          console.error(`   ❌ Failed to map ${sourceName} ID ${doc._id}:`, itemErr.message);
        }
      }

      // Flush remaining batch
      if (batch.length > 0) {
        if (!isDryRun) {
          await Product.bulkWrite(batch, { ordered: false });
        }
        summary.totalMigrated += batch.length;
        summary.byCategory[category].migrated += batch.length;
        batch = [];
      }

      console.log(
        `✅ Finished ${sourceName}: ${summary.byCategory[category].migrated} migrated, ${summary.byCategory[category].failed} failed.`
      );
    } catch (catErr: any) {
      console.error(`🚨 Fatal collection error migrating ${sourceName}:`, catErr.message);
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("\n===============================================================");
  console.log("🏁 MIGRATION PROCESS SUMMARY REPORT");
  console.log("===============================================================");
  console.log(`⏱️ Duration: ${durationSec} seconds`);
  console.log(`📊 Total Legacy Documents Scanned: ${summary.totalScanned}`);
  console.log(`✅ Total Successfully Migrated:   ${summary.totalMigrated}`);
  console.log(`❌ Total Failed:                  ${summary.totalFailed}`);
  console.log("\nBreakdown by Category:");
  for (const [cat, counts] of Object.entries(summary.byCategory)) {
    console.log(`  - ${cat.padEnd(20)}: ${counts.migrated} / ${counts.scanned} migrated (${counts.failed} failed)`);
  }
  console.log("===============================================================");

  await mongoose.disconnect();
  console.log("🍃 MongoDB connection closed.");
};

migrate().catch((err) => {
  console.error("🚨 Fatal unhandled error in migration script:", err);
  process.exit(1);
});
