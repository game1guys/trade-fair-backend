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
    "SELECT id, payer_user_id, amount_minor, currency, status, razorpay_payment_id, service_booking_id FROM payments WHERE id = ?",
    [id]
  );
  return rows.length ? rows[0] : null;
}

export async function listPaymentsByPayer(pool: Pool, payerUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, p.amount_minor, p.currency, p.status, p.created_at,
            p.booking_id, p.ticket_order_id, p.service_booking_id, p.razorpay_order_id, p.razorpay_payment_id,
            i.invoice_number
     FROM payments p
     LEFT JOIN invoices i ON i.payment_id = p.id
     WHERE p.payer_user_id = ?
     ORDER BY p.created_at DESC`,
    [payerUserId]
  );
  return rows.map((x) => ({
    id: String(x.id),
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
  }));
}
