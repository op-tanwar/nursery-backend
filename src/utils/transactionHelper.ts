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
    const errMsg = typeof err?.message === "string" ? err.message : "";
    const isStandaloneError =
      err?.codeName === "IllegalOperation" ||
      err?.code === 20 ||
      err?.code === 59 ||
      errMsg.includes("Transaction numbers are only allowed on a replica set") ||
      errMsg.includes("Transactions are not supported by this deployment") ||
      errMsg.includes("This MongoDB deployment does not support retryable writes") ||
      errMsg.includes("Please use a replica set") ||
      errMsg.includes("not support retryable writes") ||
      errMsg.includes("not supported by this deployment");

    if (isStandaloneError) {
      // ⚠️ Graceful fallback: abort/end previous failed session and run without session
      if (session) {
        try {
          if (session.inTransaction()) {
            await session.abortTransaction();
          }
        } catch (_) { /* ignore */ }
        try {
          await session.endSession();
        } catch (_) { /* ignore */ }
        session = undefined;
      }
      console.warn(
        "[withTransaction] Standalone MongoDB detected — running without ACID session. " +
        "This is safe for local dev but deploy with a replica set in production."
      );
      return fn(undefined);
    }

    // For any other error, abort and re-throw
    if (session) {
      try {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }
      } catch (_) { /* ignore */ }
    }
    throw err;
  } finally {
    if (session) {
      try {
        await session.endSession();
      } catch (_) { /* ignore */ }
    }
  }
}
