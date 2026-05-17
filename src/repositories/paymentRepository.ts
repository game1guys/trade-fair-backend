import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function insertPayment(
  pool: Pool,
  input: {
    payerUserId: bigint;
    amountMinor: bigint;
    currency: string;
    status: "created" | "authorized" | "captured" | "failed";
    razorpayOrderId: string | null;
    razorpayPaymentId: string | null;
    bookingId: bigint | null;
    ticketOrderId: bigint | null;
    serviceBookingId?: bigint | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO payments (payer_user_id, amount_minor, currency, status, razorpay_order_id, razorpay_payment_id, booking_id, ticket_order_id, service_booking_id, metadata)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      input.payerUserId,
      input.amountMinor,
      input.currency,
      input.status,
      input.razorpayOrderId,
      input.razorpayPaymentId,
      input.bookingId,
      input.ticketOrderId,
      input.serviceBookingId ?? null,
      input.metadata != null ? JSON.stringify(input.metadata) : null,
    ]
  );
  return BigInt(r.insertId);
}

export async function findPaymentById(pool: Pool, id: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, payer_user_id, amount_minor, currency, status,
            razorpay_order_id, razorpay_payment_id, service_booking_id, booking_id, ticket_order_id, metadata
     FROM payments WHERE id = ?`,
    [id]
  );
  return rows.length ? rows[0] : null;
}

export async function findPaymentByRazorpayOrderAndPayer(pool: Pool, payerUserId: bigint, razorpayOrderId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, payer_user_id, amount_minor, currency, status, razorpay_order_id, razorpay_payment_id, metadata
     FROM payments WHERE payer_user_id = ? AND razorpay_order_id = ? LIMIT 1`,
    [payerUserId, razorpayOrderId]
  );
  return rows.length ? rows[0] : null;
}

export async function updatePaymentCaptured(pool: Pool, paymentId: bigint, razorpayPaymentId: string): Promise<void> {
  await pool.query(
    `UPDATE payments SET status = 'captured', razorpay_payment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [razorpayPaymentId, paymentId]
  );
}

export async function updatePaymentRazorpayOrderId(pool: Pool, paymentId: bigint, razorpayOrderId: string): Promise<void> {
  await pool.query(`UPDATE payments SET razorpay_order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
    razorpayOrderId,
    paymentId,
  ]);
}

export async function listPayments(pool: Pool, opts?: { payerUserId?: bigint; status?: string }) {
  const clauses: string[] = ["1=1"];
  const params: unknown[] = [];
  if (opts?.payerUserId) {
    clauses.push("p.payer_user_id = ?");
    params.push(opts.payerUserId);
  }
  if (opts?.status) {
    clauses.push("p.status = ?");
    params.push(opts.status);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, p.payer_user_id, p.amount_minor, p.currency, p.status, p.created_at,
            p.booking_id, p.ticket_order_id, p.service_booking_id, p.razorpay_order_id, p.razorpay_payment_id,
            p.metadata, i.invoice_number, u.full_name AS payer_name, u.email AS payer_email
     FROM payments p
     INNER JOIN users u ON u.id = p.payer_user_id
     LEFT JOIN invoices i ON i.payment_id = p.id
     WHERE ${clauses.join(" AND ")}
     ORDER BY p.created_at DESC
     LIMIT 200`,
    params
  );
  return rows.map((x) => ({
    id: String(x.id),
    payerUserId: String(x.payer_user_id),
    payerName: String(x.payer_name),
    payerEmail: String(x.payer_email),
    amountMinor: String(x.amount_minor),
    currency: String(x.currency),
    status: String(x.status),
    createdAt: x.created_at,
    bookingId: x.booking_id != null ? String(x.booking_id) : null,
    ticketOrderId: x.ticket_order_id != null ? String(x.ticket_order_id) : null,
    serviceBookingId: x.service_booking_id != null ? String(x.service_booking_id) : null,
    razorpayOrderId: x.razorpay_order_id != null ? String(x.razorpay_order_id) : null,
    razorpayPaymentId: x.razorpay_payment_id != null ? String(x.razorpay_payment_id) : null,
    invoiceNumber: x.invoice_number != null ? String(x.invoice_number) : null,
    metadata: typeof x.metadata === "string" ? JSON.parse(x.metadata) : x.metadata,
  }));
}

export async function listPaymentsByPayer(pool: Pool, payerUserId: bigint) {
  return listPayments(pool, { payerUserId });
}

/** Shallow-merge JSON into `payments.metadata` (MySQL JSON_MERGE_PATCH). */
export async function mergePaymentMetadata(pool: Pool, paymentId: bigint, patch: Record<string, unknown>): Promise<void> {
  await pool.query(
    `UPDATE payments
     SET metadata = JSON_MERGE_PATCH(COALESCE(metadata, '{}'), CAST(? AS JSON)),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(patch), paymentId]
  );
}
