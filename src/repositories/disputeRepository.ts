import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function createDispute(pool: Pool, input: { paymentId: bigint | null }): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO disputes (payment_id, status)
     VALUES (?, 'open')`,
    [input.paymentId]
  );
  return BigInt(r.insertId);
}

export async function listDisputes(pool: Pool, status?: "open" | "resolved" | "closed") {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT d.id, d.payment_id, d.status, d.created_at,
            p.payer_user_id, p.amount_minor, p.currency, p.status AS payment_status
     FROM disputes d
     LEFT JOIN payments p ON p.id = d.payment_id
     WHERE (? IS NULL OR d.status = ?)
     ORDER BY d.id DESC
     LIMIT 200`,
    [status ?? null, status ?? null]
  );
  return rows.map((r) => ({
    id: String(r.id),
    paymentId: r.payment_id != null ? String(r.payment_id) : null,
    status: String(r.status),
    createdAt: r.created_at,
    payment: r.payment_id
      ? {
          payerUserId: r.payer_user_id != null ? String(r.payer_user_id) : null,
          amountMinor: r.amount_minor != null ? String(r.amount_minor) : null,
          currency: r.currency != null ? String(r.currency) : null,
          paymentStatus: r.payment_status != null ? String(r.payment_status) : null,
        }
      : null,
  }));
}

export async function patchDisputeStatus(
  pool: Pool,
  id: bigint,
  nextStatus: "resolved" | "closed"
): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(`UPDATE disputes SET status = ? WHERE id = ?`, [nextStatus, id]);
  return r.affectedRows > 0;
}

