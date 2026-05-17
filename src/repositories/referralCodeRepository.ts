import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type ReferralCodeRow = RowDataPacket & {
  id: number;
  code: string;
  label: string;
  target_role_code: string;
  discount_type: "percent" | "fixed_minor";
  discount_value: number;
  max_redemptions: number | null;
  redemption_count: number;
  valid_from: Date | string | null;
  valid_until: Date | string | null;
  active: number;
  created_by_user_id: string | null;
  created_at: Date | string;
};

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export async function listReferralCodes(pool: Pool): Promise<ReferralCodeRow[]> {
  const [rows] = await pool.query<ReferralCodeRow[]>(
    `SELECT id, code, label, target_role_code, discount_type, discount_value,
            max_redemptions, redemption_count, valid_from, valid_until, active,
            created_by_user_id, created_at
     FROM referral_codes
     ORDER BY id DESC
     LIMIT 500`
  );
  return rows;
}

export async function findReferralCodeById(pool: Pool, id: number): Promise<ReferralCodeRow | null> {
  const [rows] = await pool.query<ReferralCodeRow[]>(
    `SELECT id, code, label, target_role_code, discount_type, discount_value,
            max_redemptions, redemption_count, valid_from, valid_until, active,
            created_by_user_id, created_at
     FROM referral_codes WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows.length ? rows[0] : null;
}

export async function findReferralCodeByCode(pool: Pool, code: string): Promise<ReferralCodeRow | null> {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const [rows] = await pool.query<ReferralCodeRow[]>(
    `SELECT id, code, label, target_role_code, discount_type, discount_value,
            max_redemptions, redemption_count, valid_from, valid_until, active,
            created_by_user_id, created_at
     FROM referral_codes WHERE code = ? LIMIT 1`,
    [normalized]
  );
  return rows.length ? rows[0] : null;
}

export async function userHasRedeemedCode(pool: Pool, userId: bigint, referralCodeId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM referral_redemptions WHERE user_id = ? AND referral_code_id = ? LIMIT 1",
    [userId, referralCodeId]
  );
  return rows.length > 0;
}

export async function upsertReferralCode(
  pool: Pool,
  input: {
    id?: number;
    code: string;
    label: string;
    targetRoleCode: "ORGANIZER" | "SERVICE_PROVIDER";
    discountType: "percent" | "fixed_minor";
    discountValue: number;
    maxRedemptions: number | null;
    validFrom: Date | null;
    validUntil: Date | null;
    active: boolean;
    createdByUserId: bigint | null;
  }
): Promise<number> {
  const code = normalizeCode(input.code);
  if (!code) throw new Error("Invalid code");

  if (input.id) {
    await pool.query(
      `UPDATE referral_codes SET
         code = ?, label = ?, target_role_code = ?, discount_type = ?, discount_value = ?,
         max_redemptions = ?, valid_from = ?, valid_until = ?, active = ?
       WHERE id = ?`,
      [
        code,
        input.label.trim(),
        input.targetRoleCode,
        input.discountType,
        input.discountValue,
        input.maxRedemptions,
        input.validFrom,
        input.validUntil,
        input.active ? 1 : 0,
        input.id,
      ]
    );
    return input.id;
  }

  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO referral_codes (
       code, label, target_role_code, discount_type, discount_value,
       max_redemptions, valid_from, valid_until, active, created_by_user_id
     ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      code,
      input.label.trim(),
      input.targetRoleCode,
      input.discountType,
      input.discountValue,
      input.maxRedemptions,
      input.validFrom,
      input.validUntil,
      input.active ? 1 : 0,
      input.createdByUserId,
    ]
  );
  return r.insertId;
}

export async function setReferralCodeActive(pool: Pool, id: number, active: boolean): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>("UPDATE referral_codes SET active = ? WHERE id = ?", [
    active ? 1 : 0,
    id,
  ]);
  return r.affectedRows === 1;
}

export async function insertReferralRedemption(
  pool: Pool,
  input: {
    referralCodeId: number;
    userId: bigint;
    planId: number;
    paymentId: bigint | null;
    subscriptionId: bigint | null;
    originalAmountMinor: bigint;
    discountMinor: bigint;
    amountPaidMinor: bigint;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO referral_redemptions (
       referral_code_id, user_id, plan_id, payment_id, subscription_id,
       original_amount_minor, discount_minor, amount_paid_minor
     ) VALUES (?,?,?,?,?,?,?,?)`,
    [
      input.referralCodeId,
      input.userId,
      input.planId,
      input.paymentId,
      input.subscriptionId,
      input.originalAmountMinor,
      input.discountMinor,
      input.amountPaidMinor,
    ]
  );
  await pool.query("UPDATE referral_codes SET redemption_count = redemption_count + 1 WHERE id = ?", [
    input.referralCodeId,
  ]);
  return BigInt(r.insertId);
}
