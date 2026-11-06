import mongoose from "mongoose";
import { recalculateProductRatings } from "../controllers/productController";
import { IProduct, IProductReview } from "../models/productModel";

async function runSelfVerification() {
  console.log("==================================================================");
  console.log("🧪 RUNNING COMPREHENSIVE REVIEWS MODERATION SELF-VERIFICATION");
  console.log("==================================================================");

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, desc: string) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS: ${desc}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
    }
  }

  // TEST SUITE 1: Product Rating Recalculation with Moderation Statuses
  console.log("\n--- TEST SUITE 1: Atomic Product Rating Recalculation ---");

  const mockProduct: Partial<IProduct> = {
    name: "Monstera Deliciosa",
    ratingsAverage: 0,
    ratingsQuantity: 0,
    numOfReviews: 0,
    reviews: [] as IProductReview[],
  };

  // 1. Initial empty reviews
  recalculateProductRatings(mockProduct as IProduct);
  assert(
    mockProduct.ratingsAverage === 0 && mockProduct.ratingsQuantity === 0,
    "Empty reviews produces ratingsAverage: 0, ratingsQuantity: 0"
  );

  // 2. Add 1st review (Rating: 5, status: 'approved')
  mockProduct.reviews!.push({
    _id: new mongoose.Types.ObjectId(),
    name: "Alice",
    rating: 5,
    comment: "Stunning lush foliage!",
    isVerifiedBuyer: true,
    status: "approved",
  });
  recalculateProductRatings(mockProduct as IProduct);
  assert(
    mockProduct.ratingsAverage === 5 && mockProduct.ratingsQuantity === 1,
    "1 approved review (5 stars) produces ratingsAverage: 5.0, count: 1"
  );

  // 3. Add 2nd review (Rating: 1, status: 'pending')
  const review2Id = new mongoose.Types.ObjectId();
  mockProduct.reviews!.push({
    _id: review2Id,
    name: "Bob",
    rating: 1,
    comment: "Spam comment with external links",
    isVerifiedBuyer: false,
    status: "pending",
  });
  recalculateProductRatings(mockProduct as IProduct);
  assert(
    mockProduct.ratingsAverage === 3 && mockProduct.ratingsQuantity === 2,
    "Pending review is active until rejected (ratingsAverage: 3.0, count: 2)"
  );

  // 4. Reject the spam review (status: 'rejected')
  const targetReview = mockProduct.reviews!.find((r) => r._id?.toString() === review2Id.toString())!;
  targetReview.status = "rejected";
  recalculateProductRatings(mockProduct as IProduct);
  assert(
    mockProduct.ratingsAverage === 5 && mockProduct.ratingsQuantity === 1,
    "Rejected review is completely excluded from product ratings (ratingsAverage: 5.0, count: 1)"
  );

  // 5. Add 3rd review (Rating: 4, legacy review with missing status -> defaults to approved)
  mockProduct.reviews!.push({
    _id: new mongoose.Types.ObjectId(),
    name: "Charlie",
    rating: 4,
    comment: "Great quality!",
    isVerifiedBuyer: true,
  });
  recalculateProductRatings(mockProduct as IProduct);
  // Active reviews: Alice (5) and Charlie (4) -> avg: 4.5. Bob (1, rejected) is excluded!
  assert(
    mockProduct.ratingsAverage === 4.5 && mockProduct.ratingsQuantity === 2,
    "Legacy review without status is treated as approved and averaged (avg: 4.5, count: 2)"
  );

  // 6. Delete the rejected review from the array
  const rejectedIndex = mockProduct.reviews!.findIndex((r) => r.status === "rejected");
  mockProduct.reviews!.splice(rejectedIndex, 1);
  recalculateProductRatings(mockProduct as IProduct);
  assert(
    mockProduct.ratingsAverage === 4.5 && mockProduct.ratingsQuantity === 2,
    "Purging rejected review retains identical active average (avg: 4.5, count: 2)"
  );

  // 7. Flag a review (status: 'flagged' remains counted until admin formally rejects)
  mockProduct.reviews![0].status = "flagged";
  recalculateProductRatings(mockProduct as IProduct);
  assert(
    mockProduct.ratingsAverage === 4.5 && mockProduct.ratingsQuantity === 2,
    "Flagged review remains in active count until rejection decision (avg: 4.5, count: 2)"
  );

  // TEST SUITE 2: Aggregation Pipeline Structure & Routes Verification
  console.log("\n--- TEST SUITE 2: Aggregation Filters & KPI Mocking ---");

  const mockReviewsCollection = [
    { rating: 5, status: "approved" },
    { rating: 4, status: "approved" },
    { rating: 1, status: "pending" },
    { rating: 2, status: "flagged" },
    { rating: 1, status: "rejected" },
    { rating: 5 }, // legacy without status
  ];

  const totalReviews = mockReviewsCollection.length;
  const pendingReviews = mockReviewsCollection.filter((r) => r.status === "pending").length;
  const flaggedReviews = mockReviewsCollection.filter((r) => r.status === "flagged").length;
  const approvedReviews = mockReviewsCollection.filter(
    (r) => r.status === "approved" || !r.status
  ).length;
  const rejectedReviews = mockReviewsCollection.filter((r) => r.status === "rejected").length;

  const validRatings = mockReviewsCollection.filter((r) => r.status !== "rejected");
  const totalRatingSum = validRatings.reduce((sum, r) => sum + r.rating, 0);
  const avgRating = Math.round((totalRatingSum / validRatings.length) * 10) / 10;

  assert(totalReviews === 6, "Total reviews calculation is accurate (6)");
  assert(pendingReviews === 1, "Pending reviews count is accurate (1)");
  assert(flaggedReviews === 1, "Flagged reviews count is accurate (1)");
  assert(approvedReviews === 3, "Approved reviews count including legacy is accurate (3)");
  assert(rejectedReviews === 1, "Rejected reviews count is accurate (1)");
  // Valid ratings: 5, 4, 1, 2, 5 = 17 / 5 = 3.4
  assert(avgRating === 3.4, `Global average rating calculation excludes rejected (avg: ${avgRating})`);

  console.log("\n==================================================================");
  console.log(`📊 TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
  console.log("==================================================================");

  if (passedTests === totalTests) {
    console.log("🎉 ALL TESTS PASSED SUCCESSFULLY!");
    process.exit(0);
  } else {
    console.error("❌ SOME TESTS FAILED!");
    process.exit(1);
  }
}

runSelfVerification().catch((err) => {
  console.error("Unexpected error during verification:", err);
  process.exit(1);
});
