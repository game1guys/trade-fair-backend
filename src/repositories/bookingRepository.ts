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
    `SELECT b.id, b.event_id, b.status, b.subtotal_minor, b.currency, b.created_at, b.refund_requested_at,
            b.razorpay_order_id, e.title AS event_title
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
    razorpayOrderId: r.razorpay_order_id != null ? String(r.razorpay_order_id) : null,
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

/** Organizer-only: cancel booking and release stalls (held/booked → available). */
export async function cancelBookingAsOrganizer(
  pool: Pool,
  bookingId: bigint,
  eventId: bigint
): Promise<"ok" | "not_found" | "already"> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id, status FROM bookings WHERE id = ? AND event_id = ? FOR UPDATE",
      [bookingId, eventId]
    );
    if (!rows.length) {
      await conn.rollback();
      return "not_found";
    }
    if (String(rows[0].status) === "cancelled") {
      await conn.commit();
      return "already";
    }

    const [items] = await conn.query<RowDataPacket[]>(
      "SELECT stall_id FROM booking_items WHERE booking_id = ?",
      [bookingId]
    );

    await conn.query<ResultSetHeader>(
      "UPDATE bookings SET status = 'cancelled' WHERE id = ? AND event_id = ?",
      [bookingId, eventId]
    );

    for (const row of items) {
      const sid = BigInt(row.stall_id as string);
      await conn.query(
        "UPDATE stalls SET status = 'available' WHERE id = ? AND event_id = ? AND status IN ('held','booked')",
        [sid, eventId]
      );
      await conn.query("DELETE FROM stall_holds WHERE stall_id = ?", [sid]);
    }

    await conn.commit();
    return "ok";
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
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

/** Organizer approves a stall booking that was awaiting approval (creates Razorpay order when amount &gt; 0). */
export async function approveBookingAsOrganizer(
  pool: Pool,
  bookingId: bigint,
  eventId: bigint,
  createRazorpayOrder: (amountMinor: number, currency: string, receipt: string) => Promise<{ orderId: string }>
): Promise<
  | { ok: true; razorpayOrderId: string | null }
  | { ok: false; code: "not_found" | "bad_status" | "payment_setup_failed"; message?: string }
> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [br] = await conn.query<RowDataPacket[]>(
      `SELECT b.id, b.status, b.subtotal_minor, b.exhibitor_user_id FROM bookings b
       WHERE b.id = ? AND b.event_id = ? FOR UPDATE`,
      [bookingId, eventId]
    );
    if (!br.length) {
      await conn.rollback();
      return { ok: false, code: "not_found" };
    }
    if (String(br[0].status) !== "pending_approval") {
      await conn.rollback();
      return { ok: false, code: "bad_status" };
    }
    const subtotal = BigInt(br[0].subtotal_minor as string);

    if (subtotal === 0n) {
      await conn.query<ResultSetHeader>("UPDATE bookings SET status = 'confirmed' WHERE id = ?", [bookingId]);
      const [items] = await conn.query<RowDataPacket[]>("SELECT stall_id FROM booking_items WHERE booking_id = ?", [
        bookingId,
      ]);
      for (const row of items) {
        const sid = BigInt(row.stall_id as string);
        await conn.query("UPDATE stalls SET status = 'booked' WHERE id = ? AND event_id = ?", [sid, eventId]);
        await conn.query("DELETE FROM stall_holds WHERE stall_id = ?", [sid]);
      }
      await conn.commit();
      return { ok: true, razorpayOrderId: null };
    }

    let orderId: string;
    try {
      const order = await createRazorpayOrder(Number(subtotal), "INR", `bk_${bookingId}`);
      orderId = order.orderId;
    } catch (e) {
      await conn.rollback();
      return {
        ok: false,
        code: "payment_setup_failed",
        message: e instanceof Error ? e.message : String(e),
      };
    }
    await conn.query<ResultSetHeader>(
      "UPDATE bookings SET status = 'pending', razorpay_order_id = ? WHERE id = ?",
      [orderId, bookingId]
    );
    await conn.commit();
    return { ok: true, razorpayOrderId: orderId };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export type ReassignCode = "ok" | "not_found" | "bad_item" | "bad_status" | "stall_unavailable" | "same_stall";

/** Swap one line to another stall (organizer override). */
export async function organizerReassignBookingItemStall(
  pool: Pool,
  bookingId: bigint,
  bookingItemId: bigint,
  eventId: bigint,
  newStallId: bigint
): Promise<ReassignCode> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [bk] = await conn.query<RowDataPacket[]>(
      `SELECT id, status, exhibitor_user_id, subtotal_minor FROM bookings WHERE id = ? AND event_id = ? FOR UPDATE`,
      [bookingId, eventId]
    );
    if (!bk.length) {
      await conn.rollback();
      return "not_found";
    }
    const bStatus = String(bk[0].status);
    if (bStatus === "cancelled") {
      await conn.rollback();
      return "bad_status";
    }
    const exhibitorUserId = BigInt(bk[0].exhibitor_user_id as string);

    const [items] = await conn.query<RowDataPacket[]>(
      "SELECT id, stall_id FROM booking_items WHERE id = ? AND booking_id = ? FOR UPDATE",
      [bookingItemId, bookingId]
    );
    if (!items.length) {
      await conn.rollback();
      return "bad_item";
    }
    const oldStallId = BigInt(items[0].stall_id as string);
    if (oldStallId === newStallId) {
      await conn.commit();
      return "same_stall";
    }

    const [ns] = await conn.query<RowDataPacket[]>(
      `SELECT s.id, s.status, st.price_minor FROM stalls s
       INNER JOIN stall_types st ON st.id = s.stall_type_id
       WHERE s.id = ? AND s.event_id = ? FOR UPDATE`,
      [newStallId, eventId]
    );
    if (!ns.length) {
      await conn.rollback();
      return "stall_unavailable";
    }
    const newStatus = String(ns[0].status);
    const unitPrice = BigInt(ns[0].price_minor as string);
    if (newStatus !== "available") {
      await conn.rollback();
      return "stall_unavailable";
    }

    if (bStatus === "confirmed") {
      await conn.query(
        "UPDATE stalls SET status = 'available' WHERE id = ? AND event_id = ? AND status = 'booked'",
        [oldStallId, eventId]
      );
      const [u2] = await conn.query<ResultSetHeader>(
        "UPDATE stalls SET status = 'booked' WHERE id = ? AND event_id = ? AND status = 'available'",
        [newStallId, eventId]
      );
      if (u2.affectedRows !== 1) {
        await conn.rollback();
        return "stall_unavailable";
      }
    } else if (bStatus === "pending" || bStatus === "pending_approval") {
      await conn.query(
        "UPDATE stalls SET status = 'available' WHERE id = ? AND event_id = ? AND status IN ('held','booked')",
        [oldStallId, eventId]
      );
      await conn.query("DELETE FROM stall_holds WHERE stall_id = ?", [oldStallId]);
      const [u] = await conn.query<ResultSetHeader>(
        "UPDATE stalls SET status = 'held' WHERE id = ? AND event_id = ? AND status = 'available'",
        [newStallId, eventId]
      );
      if (u.affectedRows !== 1) {
        await conn.rollback();
        return "stall_unavailable";
      }
      await conn.query(
        "INSERT INTO stall_holds (stall_id, holder_user_id, expires_at) VALUES (?,?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))",
        [newStallId, exhibitorUserId]
      );
    } else {
      await conn.rollback();
      return "bad_status";
    }

    await conn.query<ResultSetHeader>(
      "UPDATE booking_items SET stall_id = ?, unit_price_minor = ? WHERE id = ? AND booking_id = ?",
      [newStallId, unitPrice, bookingItemId, bookingId]
    );
    const [[sumRow]] = await conn.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(unit_price_minor), 0) AS s FROM booking_items WHERE booking_id = ?",
      [bookingId]
    );
    const newSub = BigInt(String(sumRow?.s ?? "0"));
    await conn.query<ResultSetHeader>("UPDATE bookings SET subtotal_minor = ? WHERE id = ?", [newSub, bookingId]);

    await conn.commit();
    return "ok";
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
