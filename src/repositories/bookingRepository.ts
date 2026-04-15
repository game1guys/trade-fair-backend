import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function insertBooking(
  pool: Pool,
  input: {
    eventId: bigint;
    exhibitorUserId: bigint;
    subtotalMinor: bigint;
    currency: string;
    razorpayOrderId: string | null;
    status: "pending" | "confirmed" | "cancelled";
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO bookings (event_id, exhibitor_user_id, status, currency, subtotal_minor, razorpay_order_id)
     VALUES (?,?,?,?,?,?)`,
    [
      input.eventId,
      input.exhibitorUserId,
      input.status,
      input.currency,
      input.subtotalMinor,
      input.razorpayOrderId,
    ]
  );
  return BigInt(r.insertId);
}

export async function insertBookingItem(
  pool: Pool,
  bookingId: bigint,
  stallId: bigint,
  unitPriceMinor: bigint
): Promise<void> {
  await pool.query(
    `INSERT INTO booking_items (booking_id, stall_id, unit_price_minor) VALUES (?,?,?)`,
    [bookingId, stallId, unitPriceMinor]
  );
}

export async function updateBookingStatus(
  pool: Pool,
  bookingId: bigint,
  exhibitorUserId: bigint,
  status: "pending" | "confirmed" | "cancelled",
  razorpayOrderId?: string | null
): Promise<boolean> {
  if (razorpayOrderId !== undefined) {
    const [r] = await pool.query<ResultSetHeader>(
      "UPDATE bookings SET status = ?, razorpay_order_id = ? WHERE id = ? AND exhibitor_user_id = ?",
      [status, razorpayOrderId, bookingId, exhibitorUserId]
    );
    return r.affectedRows > 0;
  }
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE bookings SET status = ? WHERE id = ? AND exhibitor_user_id = ?",
    [status, bookingId, exhibitorUserId]
  );
  return r.affectedRows > 0;
}

export async function findBookingByRazorpayOrderId(
  pool: Pool,
  razorpayOrderId: string
): Promise<{
  id: bigint;
  event_id: bigint;
  exhibitor_user_id: bigint;
  status: string;
  subtotal_minor: bigint;
} | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, event_id, exhibitor_user_id, status, subtotal_minor FROM bookings WHERE razorpay_order_id = ? LIMIT 1",
    [razorpayOrderId]
  );
  if (!rows.length) return null;
  const x = rows[0];
  return {
    id: BigInt(x.id as string),
    event_id: BigInt(x.event_id as string),
    exhibitor_user_id: BigInt(x.exhibitor_user_id as string),
    status: String(x.status),
    subtotal_minor: BigInt(x.subtotal_minor as string),
  };
}

export async function listBookingsForExhibitor(pool: Pool, exhibitorUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT b.id, b.event_id, b.status, b.subtotal_minor, b.currency, b.created_at, b.refund_requested_at, e.title AS event_title
     FROM bookings b
     INNER JOIN events e ON e.id = b.event_id
     WHERE b.exhibitor_user_id = ?
     ORDER BY b.created_at DESC`,
    [exhibitorUserId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    eventId: String(r.event_id),
    eventTitle: r.event_title,
    status: r.status,
    subtotalMinor: String(r.subtotal_minor),
    currency: r.currency,
    createdAt: r.created_at,
    refundRequestedAt: r.refund_requested_at ?? null,
  }));
}

export async function setBookingRefundRequested(
  pool: Pool,
  bookingId: bigint,
  exhibitorUserId: bigint
): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE bookings SET refund_requested_at = NOW()
     WHERE id = ? AND exhibitor_user_id = ? AND status = 'confirmed' AND refund_requested_at IS NULL`,
    [bookingId, exhibitorUserId]
  );
  return r.affectedRows > 0;
}

export async function findBookingForExhibitor(
  pool: Pool,
  bookingId: bigint,
  exhibitorUserId: bigint
): Promise<{ id: bigint; event_id: bigint; status: string; subtotal_minor: bigint; razorpay_order_id: string | null } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, event_id, status, subtotal_minor, razorpay_order_id FROM bookings WHERE id = ? AND exhibitor_user_id = ? LIMIT 1",
    [bookingId, exhibitorUserId]
  );
  if (!rows.length) return null;
  const x = rows[0];
  return {
    id: BigInt(x.id as string),
    event_id: BigInt(x.event_id as string),
    status: String(x.status),
    subtotal_minor: BigInt(x.subtotal_minor as string),
    razorpay_order_id: x.razorpay_order_id,
  };
}
