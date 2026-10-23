import mongoose from "mongoose";

let isConnecting = false;

const connectDatabase = async (): Promise<void> => {
  // If already connected, reuse connection (essential for serverless/hot reload)
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (isConnecting) {
    return;
  }

  try {
    isConnecting = true;
    const dbUri = process.env.DB_URI;

    if (!dbUri) {
      throw new Error("DB_URI is not defined in environment variables");
    }

    const conn = await mongoose.connect(dbUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);
    isConnecting = false;
  } catch (error) {
    isConnecting = false;
    console.error("Error connecting to MongoDB:", error);
    if (process.env.NODE_ENV === "production") {
      // In production, do not hard-exit immediately so transient network blips can recover
      console.warn("MongoDB initial connection failed, retrying on subsequent requests...");
    } else {
      process.exit(1);
    }
  }
};

mongoose.connection.on("error", (err) => {
  console.error("Mongoose connection runtime error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.warn("Mongoose disconnected from MongoDB.");
});

mongoose.connection.on("reconnected", () => {
  console.log("Mongoose reconnected to MongoDB successfully.");
});

export default connectDatabase;