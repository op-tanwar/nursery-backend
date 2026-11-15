import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

async function inspectDb() {
  const uri = process.env.DB_URI || process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/planto";
  console.log("Connecting to:", uri.replace(/\/\/.*@/, "//***@"));
  await mongoose.connect(uri);

  const db = mongoose.connection.db;
  if (!db) {
    console.error("No DB connection");
    process.exit(1);
  }

  // 1. Check Nurseries
  const nurseries = await db.collection("nurseryprofiles").find({}).toArray();
  console.log(`\n=== NURSERY PROFILES (${nurseries.length}) ===`);
  for (const n of nurseries) {
    console.log({
      _id: n._id.toString(),
      nursery: n.nursery?.toString(),
      businessName: n.businessName,
      slug: n.slug,
      isActive: n.isActive,
      approvalStatus: n.approvalStatus,
      verificationStatus: n.verificationStatus,
    });
  }

  // 2. Check Nursery Users
  const users = await db.collection("users").find({ role: "nursery" }).toArray();
  console.log(`\n=== NURSERY USERS (${users.length}) ===`);
  for (const u of users) {
    console.log({
      _id: u._id.toString(),
      name: u.name,
      email: u.email,
      isActive: u.isActive,
      isBlocked: u.isBlocked,
      status: u.status,
    });
  }

  // 3. Check Products count and isNurseryActive distribution
  const totalProducts = await db.collection("products").countDocuments();
  const withIsNurseryActiveTrue = await db.collection("products").countDocuments({ isNurseryActive: true });
  const withIsNurseryActiveFalse = await db.collection("products").countDocuments({ isNurseryActive: false });
  const withIsNurseryActiveUndefined = await db.collection("products").countDocuments({ isNurseryActive: { $exists: false } });

  console.log(`\n=== PRODUCTS DISTRIBUTION (${totalProducts}) ===`);
  console.log(`isNurseryActive: true       -> ${withIsNurseryActiveTrue}`);
  console.log(`isNurseryActive: false      -> ${withIsNurseryActiveFalse}`);
  console.log(`isNurseryActive: undefined  -> ${withIsNurseryActiveUndefined}`);

  // Sample 5 products
  const sampleProducts = await db.collection("products").find({}).limit(5).toArray();
  console.log("\n=== SAMPLE PRODUCTS ===");
  for (const p of sampleProducts) {
    console.log({
      _id: p._id.toString(),
      name: p.name,
      category: p.category,
      nursery: p.nursery?.toString(),
      isPublished: p.isPublished,
      isActive: p.isActive,
      isNurseryActive: p.isNurseryActive,
    });
  }

  await mongoose.disconnect();
}

inspectDb().catch((err) => {
  console.error("DB inspection failed:", err);
  process.exit(1);
});
