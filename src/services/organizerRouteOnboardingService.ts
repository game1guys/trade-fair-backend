import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";
import { razorpayApiJson } from "./razorpayService.js";

const P = env.razorpay.routeLinkedAccountDefaults;

/** Last 10 digits for Indian mobiles; Razorpay expects 8–15 digit phone. */
export function normalizeIndianPhoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (d.length >= 10) return d.slice(-10);
  if (d.length >= 8) return d;
  return null;
}

function sanitizeRouteName(raw: string, minLen: number): string {
  let t = raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length < minLen) t = `${t} Organizer`.trim();
  if (t.length < minLen) t = "Organizer";
  return t.slice(0, 200);
}

function referenceIdForUser(userId: bigint): string {
  const s = `tfw_u_${userId.toString()}`;
  return s.length <= 20 ? s : s.slice(0, 20);
}

type CreateAccountRes = { id?: string };
type CreateProductRes = { id?: string };

/**
 * Razorpay Route: linked account + stakeholder + route product + settlement bank.
 * Requires Route / linked-account APIs on the Razorpay merchant account.
 * @see https://razorpay.com/docs/payments/route/integration-guide/
 */
export async function createRouteLinkedAccountForOrganizer(input: {
  userId: bigint;
  email: string;
  phoneDigits: string;
  legalBusinessName: string;
  contactName: string;
  bankAccountNumber: string;
  ifsc: string;
  beneficiaryName: string;
  stakeholderPan?: string;
}): Promise<string> {
  const email = input.email.toLowerCase().trim();
  const phone = input.phoneDigits.replace(/\D/g, "");
  if (!email.includes("@")) throw new HttpError(400, "Valid email required for Razorpay Route onboarding");
  if (phone.length < 8 || phone.length > 15) throw new HttpError(400, "Valid phone required for Razorpay Route onboarding");

  const legalName = sanitizeRouteName(input.legalBusinessName, 4);
  const contactName = sanitizeRouteName(input.contactName, 4);
  const beneficiary = sanitizeRouteName(input.beneficiaryName, 4);

  const createBody: Record<string, unknown> = {
    email,
    phone,
    type: "route",
    reference_id: referenceIdForUser(input.userId),
    legal_business_name: legalName,
    business_type: P.businessType,
    contact_name: contactName,
    profile: {
      category: P.category,
      subcategory: P.subcategory,
      addresses: {
        registered: {
          street1: P.street1,
          street2: "",
          city: P.city,
          state: P.state,
          postal_code: P.postalCode,
          country: "IN",
        },
      },
    },
  };

  const account = await razorpayApiJson<CreateAccountRes>("POST", "/v2/accounts", createBody);
  const accountId = typeof account.id === "string" && account.id.startsWith("acc_") ? account.id : null;
  if (!accountId) throw new HttpError(502, "Razorpay linked account response missing acc_ id");

  const stakeholderBody: Record<string, unknown> = {
    name: contactName,
    email,
    percentage_ownership: 100,
    relationship: { executive: true },
    phone: { primary: Number(phone) },
    addresses: {
      residential: {
        street: P.street1,
        city: P.city,
        state: P.state,
        postal_code: P.postalCode,
        country: "IN",
      },
    },
  };
  const pan = (input.stakeholderPan ?? env.razorpay.routeStakeholderPanFallback ?? "").trim().toUpperCase();
  if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    stakeholderBody.kyc = { pan };
  }

  await razorpayApiJson("POST", `/v2/accounts/${encodeURIComponent(accountId)}/stakeholders`, stakeholderBody);

  const product = await razorpayApiJson<CreateProductRes>(
    "POST",
    `/v2/accounts/${encodeURIComponent(accountId)}/products`,
    {
      product_name: "route",
      tnc_accepted: true,
    }
  );
  const productId = typeof product.id === "string" && product.id.length > 0 ? product.id : null;
  if (!productId) throw new HttpError(502, "Razorpay Route product response missing id");

  await razorpayApiJson(
    "PATCH",
    `/v2/accounts/${encodeURIComponent(accountId)}/products/${encodeURIComponent(productId)}`,
    {
      settlements: {
        account_number: input.bankAccountNumber,
        ifsc_code: input.ifsc,
        beneficiary_name: beneficiary,
      },
      tnc_accepted: true,
    }
  );

  return accountId;
}
