import dotenv from "dotenv";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const kid = (process.env.RAZORPAY_KEY_ID || "").trim();
const ks = (process.env.RAZORPAY_KEY_SECRET || "").trim();

if (!kid || !ks) {
  console.log(JSON.stringify({ ok: false, error: "Missing RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET" }));
  process.exit(1);
}

const auth = Buffer.from(`${kid}:${ks}`).toString("base64");
const res = await fetch("https://api.razorpay.com/v1/orders", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Basic ${auth}`,
  },
  body: JSON.stringify({ amount: 100, currency: "INR", receipt: "smoke_1" }),
});
const bodyText = await res.text();
console.log(JSON.stringify({ status: res.status, ok: res.ok, body: bodyText.slice(0, 500) }));

