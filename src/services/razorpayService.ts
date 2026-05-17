import crypto from "crypto";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

function assertConfigured() {
  if (!env.razorpay.keyId || !env.razorpay.keySecret) {
    throw new HttpError(503, "Razorpay is not configured (set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)");
  }
}

/** Razorpay JSON uses `error: { description }` or sometimes a string. */
function razorpayErrorDescription(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const err = (data as { error?: unknown }).error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "description" in err) {
    const d = (err as { description?: unknown }).description;
    return typeof d === "string" ? d : null;
  }
  return null;
}

function looksLikeRazorpayCredentialFailure(
  httpStatus: number,
  data: unknown,
  description: string,
  rawBody: string
): boolean {
  if (httpStatus === 401) return true;
  const norm = description.normalize("NFKC").trim().toLowerCase();
  const rawLower = rawBody.normalize("NFKC").trim().toLowerCase();
  const phrases = [
    "authentication failed",
    "authentication credentials were not provided",
    "incorrect api key",
    "invalid api key",
    "invalid key",
    "wrong api key",
    "access denied",
  ];
  if (phrases.some((p) => norm.includes(p) || rawLower.includes(p))) return true;
  if (norm.includes("key") && (norm.includes("invalid") || norm.includes("incorrect") || norm.includes("wrong"))) {
    return true;
  }
  try {
    const blob = JSON.stringify(data ?? {}).toLowerCase();
    if (phrases.some((p) => blob.includes(p))) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Razorpay returns auth errors when KEY_ID / KEY_SECRET are wrong (sometimes HTTP 401, sometimes 400/502 with the same description).
 * That is not the end-user's login — map to a clear server configuration message.
 */
function httpErrorFromRazorpayResponse(
  httpStatus: number,
  data: unknown,
  rawBody: string,
  fallback: string
): HttpError {
  const description = (razorpayErrorDescription(data) ?? fallback).normalize("NFKC").trim();
  if (looksLikeRazorpayCredentialFailure(httpStatus, data, description, rawBody)) {
    return new HttpError(
      503,
      "Razorpay API keys are invalid or mismatched. In trade-fair-backend/.env set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET from Razorpay Dashboard → Account & Settings → API Keys. Use test keys only with a test key id (rzp_test_…), live with rzp_live_…."
    );
  }
  return new HttpError(502, description || fallback);
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
  const rawBody = await res.text();
  let data: unknown = {};
  try {
    if (rawBody.trim()) data = JSON.parse(rawBody) as unknown;
  } catch {
    data = {};
  }
  const parsed = data as { id?: string };
  if (!res.ok) {
    throw httpErrorFromRazorpayResponse(res.status, data, rawBody, "Razorpay order failed");
  }
  if (!parsed.id) throw new HttpError(502, "Razorpay order missing id");
  return { orderId: parsed.id };
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
  const rawBody = await res.text();
  let data: unknown = {};
  try {
    if (rawBody.trim()) data = JSON.parse(rawBody) as unknown;
  } catch {
    data = {};
  }
  const parsed = data as { id?: string };
  if (!res.ok) {
    throw httpErrorFromRazorpayResponse(res.status, data, rawBody, "Razorpay refund failed");
  }
  if (!parsed.id) throw new HttpError(502, "Razorpay refund missing id");
  return { refundId: parsed.id };
}

/**
 * Route: move part of a captured payment to a linked account (`acc_…`).
 * @see https://razorpay.com/docs/payments/route/transfer-funds-to-linked-accounts/
 */
export async function createTransfersForCapturedPayment(
  razorpayPaymentId: string,
  transfers: { account: string; amount: number; currency: string }[]
): Promise<unknown> {
  assertConfigured();
  if (!transfers.length) throw new HttpError(400, "No transfers");
  const auth = Buffer.from(`${env.razorpay.keyId}:${env.razorpay.keySecret}`).toString("base64");
  const res = await fetch(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpayPaymentId)}/transfers`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ transfers }),
    }
  );
  const rawBody = await res.text();
  let data: unknown = {};
  try {
    if (rawBody.trim()) data = JSON.parse(rawBody) as unknown;
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw httpErrorFromRazorpayResponse(res.status, data, rawBody, "Razorpay transfer failed");
  }
  return data;
}

/**
 * Generic Razorpay REST call (v1 or v2 path under https://api.razorpay.com).
 * Used for Route linked-account onboarding (`/v2/accounts`, etc.).
 */
export async function razorpayApiJson<T = unknown>(method: "GET" | "POST" | "PATCH" | "PUT", apiPath: string, body?: unknown): Promise<T> {
  assertConfigured();
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  const auth = Buffer.from(`${env.razorpay.keyId}:${env.razorpay.keySecret}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const rawBody = await res.text();
  let data: unknown = {};
  try {
    if (rawBody.trim()) data = JSON.parse(rawBody) as unknown;
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw httpErrorFromRazorpayResponse(res.status, data, rawBody, `Razorpay ${method} ${path} failed`);
  }
  return data as T;
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
