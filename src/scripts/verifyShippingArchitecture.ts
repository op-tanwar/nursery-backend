import {
  checkCartItemsPincodeServiceability,
  resolveProductShippingType,
  isNationalCourierServiceable,
  isPincodeServiceable,
  NurseryServiceabilityProfile,
  CartItemServiceabilityInput,
} from "../utils/pincodeService";

async function runShippingArchitectureVerification() {
  console.log("================================================================");
  console.log("🚚 TWO-TIER SHIPPING ARCHITECTURE (HYPERLOCAL & NATIONAL COURIER)");
  console.log("================================================================\n");

  let failures = 0;

  // Mock Nursery in Bangalore (PIN: 560001)
  const bangaloreNurseryId = "nursery_bangalore_01";
  const nurseryProfilesMap = new Map<string, NurseryServiceabilityProfile>();
  nurseryProfilesMap.set(bangaloreNurseryId, {
    businessName: "Green Thumb Nursery (Bangalore)",
    businessAddress: { pinCode: "560001" },
    deliveryPincodes: ["560001", "560002", "560025"],
  });

  // --------------------------------------------------------------------------
  // TEST SCENARIO 1: Pure Non-Perishable across cities (Bangalore -> Delhi)
  // --------------------------------------------------------------------------
  console.log("📦 [Test Scenario 1] Pure Non-Perishable Item across cities (>1500km)...");
  const potItem: CartItemServiceabilityInput = {
    productId: "prod_ceramic_pot_01",
    productName: "Glazed Ceramic Planter Pot (10-inch)",
    nurseryId: bangaloreNurseryId,
    category: "pots",
  };

  const delhiPincode = "110001"; // Connaught Place, New Delhi (~1,740 km from Bangalore)
  const result1 = await checkCartItemsPincodeServiceability(
    delhiPincode,
    [potItem],
    nurseryProfilesMap,
    12
  );

  const potShippingType = resolveProductShippingType(potItem);
  console.log(`   Resolved Shipping Type: ${potShippingType}`);
  console.log(`   Delivery Serviceable: ${result1.isServiceable}`);
  console.log(`   Unserviceable Items Count: ${result1.unserviceableItems.length}`);

  if (result1.isServiceable && potShippingType === "NATIONAL_COURIER" && result1.unserviceableItems.length === 0) {
    console.log("   ✅ PASS: Ceramic pot successfully bypassed 12km radius constraint for cross-city delivery.\n");
  } else {
    console.error("   ❌ FAIL: Ceramic pot was incorrectly blocked by hyperlocal radius.\n");
    failures++;
  }

  // --------------------------------------------------------------------------
  // TEST SCENARIO 2: Live Plant outside 12km (Bangalore -> Hosur, ~35km)
  // --------------------------------------------------------------------------
  console.log("🌿 [Test Scenario 2] Perishable Live Plant outside 12km radius (~35km)...");
  const plantItem: CartItemServiceabilityInput = {
    productId: "prod_fiddle_fig_02",
    productName: "Fiddle Leaf Fig Premium Plant",
    nurseryId: bangaloreNurseryId,
    category: "plants",
  };

  const hosurPincode = "635109"; // Hosur (~35-40 km from Bangalore center)
  const result2 = await checkCartItemsPincodeServiceability(
    hosurPincode,
    [plantItem],
    nurseryProfilesMap,
    12
  );

  const plantShippingType = resolveProductShippingType(plantItem);
  console.log(`   Resolved Shipping Type: ${plantShippingType}`);
  console.log(`   Delivery Serviceable: ${result2.isServiceable}`);
  console.log(`   Unserviceable Items:`, result2.unserviceableItems);

  if (
    !result2.isServiceable &&
    plantShippingType === "HYPERLOCAL_EXPRESS" &&
    result2.unserviceableItems.length === 1 &&
    result2.unserviceableItems[0].productId === plantItem.productId
  ) {
    console.log("   ✅ PASS: Live plant outside 12km correctly rejected with descriptive notice.\n");
  } else {
    console.error("   ❌ FAIL: Live plant was not rejected as expected.\n");
    failures++;
  }

  // --------------------------------------------------------------------------
  // TEST SCENARIO 3: Mixed Cart (Pot + Plant to Delhi, ~1740km)
  // --------------------------------------------------------------------------
  console.log("🛒 [Test Scenario 3] Mixed Cart (Pot + Plant to Delhi)...");
  const result3 = await checkCartItemsPincodeServiceability(
    delhiPincode,
    [potItem, plantItem],
    nurseryProfilesMap,
    12
  );

  console.log(`   Overall Serviceable: ${result3.isServiceable}`);
  console.log(`   Unserviceable Items Count: ${result3.unserviceableItems.length}`);
  console.log(`   Unserviceable Product IDs:`, result3.unserviceableItems.map((u) => u.productId));

  const onlyPlantFailed =
    !result3.isServiceable &&
    result3.unserviceableItems.length === 1 &&
    result3.unserviceableItems[0].productId === plantItem.productId;

  if (onlyPlantFailed) {
    console.log("   ✅ PASS: Courier item (pot) remained valid, while only perishable plant was flagged unserviceable.\n");
  } else {
    console.error("   ❌ FAIL: Mixed cart evaluation failed to isolate items properly.\n");
    failures++;
  }

  // --------------------------------------------------------------------------
  // TEST SCENARIO 4: Safe Fallback for Missing / Undefined Category
  // --------------------------------------------------------------------------
  console.log("🛡️ [Test Scenario 4] Missing / Undefined Category Safe Fallback...");
  const unknownItem: CartItemServiceabilityInput = {
    productId: "prod_unknown_99",
    productName: "Uncategorized Item",
    nurseryId: bangaloreNurseryId,
    // category intentionally omitted
  };

  const unknownShippingType = resolveProductShippingType(unknownItem);
  console.log(`   Resolved Shipping Type for Uncategorized Item: ${unknownShippingType}`);

  const result4 = await checkCartItemsPincodeServiceability(
    delhiPincode,
    [unknownItem],
    nurseryProfilesMap,
    12
  );

  if (unknownShippingType === "HYPERLOCAL_EXPRESS" && !result4.isServiceable) {
    console.log("   ✅ PASS: Undefined category safely defaulted to HYPERLOCAL_EXPRESS to prevent accidental courier shipment.\n");
  } else {
    console.error("   ❌ FAIL: Undefined category did not fall back safely to HYPERLOCAL_EXPRESS.\n");
    failures++;
  }

  // --------------------------------------------------------------------------
  // TEST SCENARIO 5: Both items within 12km (Bangalore center -> nearby PIN 560002)
  // --------------------------------------------------------------------------
  console.log("📍 [Test Scenario 5] Both items within 12km hyperlocal zone (Bangalore local)...");
  const localBangalorePin = "560002"; // ~2-3 km from 560001
  const result5 = await checkCartItemsPincodeServiceability(
    localBangalorePin,
    [potItem, plantItem],
    nurseryProfilesMap,
    12
  );

  console.log(`   Overall Serviceable: ${result5.isServiceable}`);
  console.log(`   Unserviceable Items Count: ${result5.unserviceableItems.length}`);

  if (result5.isServiceable && result5.unserviceableItems.length === 0) {
    console.log("   ✅ PASS: All items within hyperlocal radius are fully serviceable.\n");
  } else {
    console.error("   ❌ FAIL: Local items were rejected unexpectedly.\n");
    failures++;
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log("================================================================");
  if (failures === 0) {
    console.log("🎉 ALL 5 SHIPPING ARCHITECTURE SCENARIOS VERIFIED SUCCESSFULLY!");
    console.log("================================================================");
    process.exit(0);
  } else {
    console.error(`💥 VERIFICATION FAILED WITH ${failures} FAILURE(S)`);
    console.log("================================================================");
    process.exit(1);
  }
}

runShippingArchitectureVerification().catch((err) => {
  console.error("Fatal error during shipping verification:", err);
  process.exit(1);
});
