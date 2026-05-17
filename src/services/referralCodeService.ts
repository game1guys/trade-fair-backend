import type { Pool } from "mysql2/promise";
import * as referralRepo from "../repositories/referralCodeRepository.js";
import { HttpError } from "../utils/httpError.js";

export type ReferralQuote = {
  referralCodeId: number;
  code: string;
  label: string;
  originalAmountMinor: bigint;
  discountMinor: bigint;
  finalAmountMinor: bigint;
  discountLabel: string;
};

function discountLabel(row: referralRepo.ReferralCodeRow, discountMinor: bigint, original: bigint): string {
  if (row.discount_type === "percent") {
    return `${row.discount_value}% off`;
  }
  const fixed = BigInt(row.discount_value);
  if (discountMinor >= original) return `₹${(Number(fixed) / 100).toFixed(2)} off (full waiver)`;
  return `₹${(Number(discountMinor) / 100).toFixed(2)} off`;
}

export function computeDiscountedAmount(
  priceMinor: bigint,
  discountType: "percent" | "fixed_minor",
  discountValue: number
): { discountMinor: bigint; finalAmountMinor: bigint } {
  if (priceMinor <= 0n) return { discountMinor: 0n, finalAmountMinor: 0n };

  let discountMinor = 0n;
  if (discountType === "percent") {
    const pct = Math.min(100, Math.max(0, Math.trunc(discountValue)));
    discountMinor = (priceMinor * BigInt(pct)) / 100n;
  } else {
    discountMinor = BigInt(Math.max(0, Math.trunc(discountValue)));
    if (discountMinor > priceMinor) discountMinor = priceMinor;
  }
  const finalAmountMinor = priceMinor - discountMinor;
  return { discountMinor, finalAmountMinor };
}

export async function resolveReferralForSubscription(
  pool: Pool,
  input: {
    code: string;
    userId: bigint;
    targetRoleCode: string;
    planId: number;
    priceMinor: bigint;
  }
): Promise<ReferralQuote> {
  const row = await referralRepo.findReferralCodeByCode(pool, input.code);
  if (!row) throw new HttpError(400, "Invalid referral code");
  if (!Number(row.active)) throw new HttpError(400, "This referral code is no longer active");

  const targetRole = String(row.target_role_code).toUpperCase();
  if (targetRole !== input.targetRoleCode.toUpperCase()) {
    throw new HttpError(400, `This code is for ${targetRole === "SERVICE_PROVIDER" ? "service providers" : "organisers"} only`);
  }

  const now = Date.now();
  if (row.valid_from) {
    const from = new Date(row.valid_from).getTime();
    if (now < from) throw new HttpError(400, "This offer is not active yet");
  }
  if (row.valid_until) {
    const until = new Date(row.valid_until).getTime();
    if (now > until) throw new HttpError(400, "This referral code has expired");
  }

  if (row.max_redemptions != null && Number(row.redemption_count) >= Number(row.max_redemptions)) {
    throw new HttpError(400, "This referral code has reached its usage limit");
  }

  const already = await referralRepo.userHasRedeemedCode(pool, input.userId, Number(row.id));
  if (already) throw new HttpError(400, "You have already used this referral code");

  const { discountMinor, finalAmountMinor } = computeDiscountedAmount(
    input.priceMinor,
    row.discount_type,
    Number(row.discount_value)
  );

  return {
    referralCodeId: Number(row.id),
    code: String(row.code),
    label: String(row.label),
    originalAmountMinor: input.priceMinor,
    discountMinor,
    finalAmountMinor,
    discountLabel: discountLabel(row, discountMinor, input.priceMinor),
  };
}
