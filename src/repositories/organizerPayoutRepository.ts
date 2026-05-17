import type { Pool, RowDataPacket } from "mysql2/promise";

export type OrganizerPayoutProfileRow = {
  userId: bigint;
  accountHolderName: string;
  bankAccountNumber: string | null;
  ifsc: string | null;
  upiId: string | null;
  razorpayLinkedAccountId: string | null;
  updatedAt: Date;
};

export async function findOrganizerPayoutProfile(pool: Pool, userId: bigint): Promise<OrganizerPayoutProfileRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT user_id, account_holder_name, bank_account_number, ifsc, upi_id, razorpay_linked_account_id, updated_at
     FROM organizer_payout_profiles WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    userId: BigInt(r.user_id as string),
    accountHolderName: String(r.account_holder_name),
    bankAccountNumber: r.bank_account_number != null ? String(r.bank_account_number) : null,
    ifsc: r.ifsc != null ? String(r.ifsc) : null,
    upiId: r.upi_id != null ? String(r.upi_id) : null,
    razorpayLinkedAccountId: r.razorpay_linked_account_id != null ? String(r.razorpay_linked_account_id) : null,
    updatedAt: r.updated_at as Date,
  };
}

export async function upsertOrganizerPayoutProfile(
  pool: Pool,
  input: {
    userId: bigint;
    accountHolderName: string;
    bankAccountNumber: string | null;
    ifsc: string | null;
    upiId: string | null;
    razorpayLinkedAccountId: string | null;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO organizer_payout_profiles
      (user_id, account_holder_name, bank_account_number, ifsc, upi_id, razorpay_linked_account_id)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       account_holder_name = VALUES(account_holder_name),
       bank_account_number = VALUES(bank_account_number),
       ifsc = VALUES(ifsc),
       upi_id = VALUES(upi_id),
       razorpay_linked_account_id = VALUES(razorpay_linked_account_id),
       updated_at = CURRENT_TIMESTAMP`,
    [
      input.userId,
      input.accountHolderName,
      input.bankAccountNumber,
      input.ifsc,
      input.upiId,
      input.razorpayLinkedAccountId,
    ]
  );
}
