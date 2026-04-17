import crypto from "crypto";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

function assertConfigured() {
  if (!env.razorpay.keyId || !env.razorpay.keySecret) {
    throw new HttpError(503, "Razorpay is not configured (set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)");
  }
}

/** amountMinor in paise for INR */
export async function createOrder(amountMinor: number, currency: string, receipt: string) {
  assertConfigured();
  const auth = Buffer.from(`${env.razorpay.keyId}:${env.razorpay.keySecret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      amount: amountMinor,
      currency: currency.toUpperCase(),
      receipt: receipt.slice(0, 40),
    }),
  });
  const data = (await res.json()) as { id?: string; error?: { description?: string } };
  if (!res.ok) {
    throw new HttpError(502, data.error?.description ?? "Razorpay order failed");
  }
  if (!data.id) throw new HttpError(502, "Razorpay order missing id");
  return { orderId: data.id };
}

export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!env.razorpay.keySecret) return false;
  const sig = signature.trim();
  const body = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac("sha256", env.razorpay.keySecret)
    .update(body, "utf8")
    .digest("hex");
  if (expected.length !== sig.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
}

/** Razorpay sends a lowercase hex SHA-256 HMAC of the raw JSON body. */
/** Initiate a partial or full refund on Razorpay (amountMinor in paise). */
export async function createRefund(razorpayPaymentId: string, amountMinor: number) {
  assertConfigured();
  const auth = Buffer.from(`${env.razorpay.keyId}:${env.razorpay.keySecret}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpayPaymentId)}/refund`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ amount: amountMinor }),
  });
  const data = (await res.json()) as { id?: string; error?: { description?: string } };
  if (!res.ok) {
    throw new HttpError(502, data.error?.description ?? "Razorpay refund failed");
  }
  if (!data.id) throw new HttpError(502, "Razorpay refund missing id");
  return { refundId: data.id };
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const sig = typeof signatureHeader === "string" ? signatureHeader.trim() : "";
  if (!env.razorpay.webhookSecret || !sig) return false;

  const expected = crypto
    .createHmac("sha256", env.razorpay.webhookSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  if (expected.length !== sig.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
}
