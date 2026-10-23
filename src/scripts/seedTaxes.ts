import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import mongoose from "mongoose";

const rootEnvPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

import connectDatabase from "../database/database";
import { CategoryTax } from "../models/categoryTaxModel";
import { DEFAULT_CATEGORY_TAXES } from "../utils/taxService";

async function seedCategoryTaxes() {
  console.log("🌱 Starting Category GST Seed Script...");
  await connectDatabase();

  for (const item of DEFAULT_CATEGORY_TAXES) {
    const existing = await CategoryTax.findOne({ category: item.category });
    if (!existing) {
      await CategoryTax.create(item);
      console.log(`✅ Created default GST slab: [${item.category}] -> ${item.taxPercentage}% (${item.itemModel})`);
    } else {
      console.log(`ℹ️ [${item.category}] already exists with rate ${existing.taxPercentage}% (skipping create)`);
    }
  }

  const count = await CategoryTax.countDocuments();
  console.log(`🎉 Category GST seeding complete. Total managed categories: ${count}`);

  await mongoose.connection.close();
  process.exit(0);
}

seedCategoryTaxes().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
