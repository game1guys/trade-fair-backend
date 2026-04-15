import crypto from "crypto";
import { describe, expect, it, vi } from "vitest";

describe("razorpayService signatures", () => {
  it("verifyWebhookSignature accepts matching HMAC hex", async () => {
    vi.resetModules();
    process.env.RAZORPAY_WEBHOOK_SECRET = "test_whsec_only";
    const { verifyWebhookSignature } = await import("./razorpayService.js");
    const raw = '{"event":"payment.captured"}';
    const sig = crypto.createHmac("sha256", "test_whsec_only").update(raw, "utf8").digest("hex");
    expect(verifyWebhookSignature(raw, sig)).toBe(true);
    expect(verifyWebhookSignature(raw, "0" + sig.slice(1))).toBe(false);
    expect(verifyWebhookSignature(raw, undefined)).toBe(false);
  });

  it("verifyPaymentSignature accepts order_id|payment_id HMAC", async () => {
    vi.resetModules();
    process.env.RAZORPAY_KEY_SECRET = "test_key_secret";
    const { verifyPaymentSignature } = await import("./razorpayService.js");
    const orderId = "order_abc";
    const paymentId = "pay_xyz";
    const body = `${orderId}|${paymentId}`;
    const sig = crypto.createHmac("sha256", "test_key_secret").update(body, "utf8").digest("hex");
    expect(verifyPaymentSignature(orderId, paymentId, sig)).toBe(true);
    expect(verifyPaymentSignature(orderId, paymentId, "deadbeef")).toBe(false);
  });
});
