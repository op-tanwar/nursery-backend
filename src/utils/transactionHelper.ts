import mongoose, { ClientSession } from "mongoose";

/**
 * withTransaction — ACID transaction with graceful standalone-MongoDB fallback.
 *
 * On a replica-set / Atlas cluster → full ACID semantics.
 * On a standalone mongod (typical local dev) → runs the callback without a
 * session so local development works without needing a replica-set.
 *
 * Usage:
 *   await withTransaction(async (session) => {
 *     await Foo.create([{ ... }], { session });
 *     await Bar.updateOne({ ... }, { $set: { ... } }, { session });
 *   });
 */
export async function withTransaction<T>(
  fn: (session: ClientSession | undefined) => Promise<T>
): Promise<T> {
  let session: ClientSession | undefined;

  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (err: any) {
    // "Transaction numbers are only allowed on a replica set member or mongos"
    // Error code 20 (IllegalOperation) or code 59 (CommandNotFound on older mongo)
    const isStandaloneError =
      err?.codeName === "IllegalOperation" ||
      err?.code === 20 ||
      (typeof err?.message === "string" &&
        err.message.includes("Transaction numbers are only allowed on a replica set"));

    if (isStandaloneError) {
      // ⚠️  Graceful fallback: run without session (no atomicity, but works locally)
      if (session) {
        try { await session.abortTransaction(); } catch (_) { /* ignore */ }
      }
      console.warn(
        "[withTransaction] Standalone MongoDB detected — running without ACID session. " +
        "This is safe for local dev but deploy with a replica set in production."
      );
      return fn(undefined);
    }

    // For any other error, abort and re-throw
    if (session) {
      try { await session.abortTransaction(); } catch (_) { /* ignore */ }
    }
    throw err;
  } finally {
    if (session) {
      session.endSession();
    }
  }
}
