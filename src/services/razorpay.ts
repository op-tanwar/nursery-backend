import Razorpay from "razorpay";

let razorpayInstance: Razorpay | null = null;

export const getRazorpayInstance = (): Razorpay => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error(
      "FATAL CONFIGURATION ERROR: Razorpay credentials missing in runtime environment context."
    );
  }
  if (!razorpayInstance) {
    razorpayInstance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayInstance;
};
