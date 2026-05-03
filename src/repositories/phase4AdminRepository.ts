import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function adminAnalyticsSummary(pool: Pool) {
  const [[payments]] = await pool.query<RowDataPacket[]>(
    `SELECT
        COALESCE(SUM(CASE WHEN status = 'captured' THEN amount_minor ELSE 0 END), 0) AS gmv_minor,
        COALESCE(SUM(CASE WHEN status = 'captured' AND service_booking_id IS NOT NULL
                          THEN JSON_EXTRACT(metadata, '$.platformFeeMinor')
                          ELSE 0 END), 0) AS platform_fee_minor,
        COALESCE(SUM(CASE WHEN status = 'captured' THEN 1 ELSE 0 END), 0) AS captured_count
     FROM payments`
  );

  const [[refunds]] = await pool.query<RowDataPacket[]>(
    `SELECT
        COALESCE(SUM(CASE WHEN status IN ('processed') THEN amount_minor ELSE 0 END), 0) AS refunds_minor,
        COALESCE(SUM(CASE WHEN status IN ('processed') THEN 1 ELSE 0 END), 0) AS refunds_count
     FROM refunds`
  );

  const [[users]] = await pool.query<RowDataPacket[]>(
    `SELECT
        COUNT(*) AS total_users,
        COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END), 0) AS new_users_30d
     FROM users`
  );

  const [[stallBookings]] = await pool.query<RowDataPacket[]>(
    `SELECT
        COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) AS stalls_confirmed,
        COALESCE(SUM(CASE WHEN status IN ('pending','pending_approval') THEN 1 ELSE 0 END), 0) AS stalls_pending
     FROM bookings`
  );

  const [[activeLogins]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT actor_user_id) AS active_users_30d
     FROM audit_logs
     WHERE action = 'AUTH_LOGIN'
       AND actor_user_id IS NOT NULL
       AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
  );

  const [[ticketOrders]] = await pool.query<RowDataPacket[]>(
    `SELECT
        COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS tickets_paid,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS tickets_pending
     FROM ticket_orders`
  );

  const [[serviceBookings]] = await pool.query<RowDataPacket[]>(
    `SELECT
        COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) AS services_confirmed,
        COALESCE(SUM(CASE WHEN status = 'pending_payment' THEN 1 ELSE 0 END), 0) AS services_pending_payment
     FROM service_bookings`
  );

  const gmvMinor = BigInt(String(payments.gmv_minor ?? 0));
  const platformFeeMinor = BigInt(String(payments.platform_fee_minor ?? 0));
  const refundsMinor = BigInt(String(refunds.refunds_minor ?? 0));

  return {
    gmvMinor: String(gmvMinor),
    platformFeeMinor: String(platformFeeMinor),
    refundsMinor: String(refundsMinor),
    netMinor: String(gmvMinor - refundsMinor),
    counts: {
      paymentsCaptured: Number(payments.captured_count ?? 0),
      refundsProcessed: Number(refunds.refunds_count ?? 0),
      totalUsers: Number(users.total_users ?? 0),
      newUsers30d: Number(users.new_users_30d ?? 0),
      activeUsers30dLogins: Number(activeLogins.active_users_30d ?? 0),
      stallBookings: {
        confirmed: Number(stallBookings.stalls_confirmed ?? 0),
        pending: Number(stallBookings.stalls_pending ?? 0),
      },
      ticketOrders: {
        paid: Number(ticketOrders.tickets_paid ?? 0),
        pending: Number(ticketOrders.tickets_pending ?? 0),
      },
      serviceBookings: {
        confirmed: Number(serviceBookings.services_confirmed ?? 0),
        pendingPayment: Number(serviceBookings.services_pending_payment ?? 0),
      },
    },
  };
}

export async function adminUsersGrowthSeries(pool: Pool, days: number) {
  const n = Math.max(7, Math.min(180, days));
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE(created_at) AS day, COUNT(*) AS count
     FROM users
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at)
     ORDER BY day ASC`,
    [n]
  );
  return rows.map((r) => ({ day: String(r.day), count: Number(r.count) }));
}

export async function adminTransactionLedger(pool: Pool, limit: number) {
  const lim = Math.max(1, Math.min(500, limit));
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, p.created_at, p.payer_user_id, p.amount_minor, p.currency, p.status,
            p.razorpay_order_id, p.razorpay_payment_id,
            p.booking_id, p.ticket_order_id, p.service_booking_id,
            i.invoice_number
     FROM payments p
     LEFT JOIN invoices i ON i.payment_id = p.id
     ORDER BY p.id DESC
     LIMIT ?`,
    [lim]
  );
  return rows.map((r) => ({
    id: String(r.id),
    createdAt: r.created_at,
    payerUserId: String(r.payer_user_id),
    amountMinor: String(r.amount_minor),
    currency: String(r.currency),
    status: String(r.status),
    razorpayOrderId: r.razorpay_order_id != null ? String(r.razorpay_order_id) : null,
    razorpayPaymentId: r.razorpay_payment_id != null ? String(r.razorpay_payment_id) : null,
    bookingId: r.booking_id != null ? String(r.booking_id) : null,
    ticketOrderId: r.ticket_order_id != null ? String(r.ticket_order_id) : null,
    serviceBookingId: r.service_booking_id != null ? String(r.service_booking_id) : null,
    invoiceNumber: r.invoice_number != null ? String(r.invoice_number) : null,
  }));
}

export async function adminListFlags(pool: Pool, status?: "open" | "approved" | "rejected") {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, entity_type, entity_id, status, created_at
     FROM content_flags
     WHERE (? IS NULL OR status = ?)
     ORDER BY id DESC
     LIMIT 500`,
    [status ?? null, status ?? null]
  );
  return rows.map((r) => ({
    id: String(r.id),
    entityType: String(r.entity_type),
    entityId: String(r.entity_id),
    status: String(r.status),
    createdAt: r.created_at,
  }));
}

export async function adminPatchFlag(pool: Pool, flagId: bigint, status: "approved" | "rejected") {
  const [r] = await pool.query<{ affectedRows: number } & RowDataPacket[]>(
    "UPDATE content_flags SET status = ? WHERE id = ?",
    [status, flagId]
  );
  // mysql2 returns OkPacket-ish; easiest: run a follow-up check
  const [rows] = await pool.query<RowDataPacket[]>("SELECT id FROM content_flags WHERE id = ? LIMIT 1", [flagId]);
  return rows.length > 0;
}

export async function adminUpsertFeatured(
  pool: Pool,
  input: {
    entityType: string;
    entityId: string;
    label: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    active: boolean;
    createdByUserId: bigint;
  }
) {
  await pool.query(
    `INSERT INTO featured_listings (entity_type, entity_id, label, starts_at, ends_at, active, created_by_user_id)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       label = VALUES(label),
       starts_at = VALUES(starts_at),
       ends_at = VALUES(ends_at),
       active = VALUES(active)`,
    [
      input.entityType,
      input.entityId,
      input.label,
      input.startsAt,
      input.endsAt,
      input.active ? 1 : 0,
      input.createdByUserId,
    ]
  );
}

export async function adminListFeatured(pool: Pool) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, entity_type, entity_id, label, starts_at, ends_at, active, created_at
     FROM featured_listings
     ORDER BY id DESC
     LIMIT 500`
  );
  return rows.map((r) => ({
    id: String(r.id),
    entityType: String(r.entity_type),
    entityId: String(r.entity_id),
    label: r.label != null ? String(r.label) : null,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    active: Boolean(r.active),
    createdAt: r.created_at,
  }));
}

export async function adminDeleteFeaturedById(pool: Pool, id: bigint): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>("DELETE FROM featured_listings WHERE id = ?", [id]);
  return r.affectedRows > 0;
}

export function ledgerCsv(rows: Awaited<ReturnType<typeof adminTransactionLedger>>) {
  const header = [
    "id",
    "createdAt",
    "payerUserId",
    "amountMinor",
    "currency",
    "status",
    "razorpayOrderId",
    "razorpayPaymentId",
    "bookingId",
    "ticketOrderId",
    "serviceBookingId",
    "invoiceNumber",
  ].join(",");
  const lines = rows.map((r) =>
    [
      r.id,
      String(r.createdAt),
      r.payerUserId,
      r.amountMinor,
      r.currency,
      r.status,
      r.razorpayOrderId ?? "",
      r.razorpayPaymentId ?? "",
      r.bookingId ?? "",
      r.ticketOrderId ?? "",
      r.serviceBookingId ?? "",
      r.invoiceNumber ?? "",
    ]
      .map((x) => `"${String(x).replaceAll('"', '""')}"`)
      .join(",")
  );
  return [header, ...lines].join("\n");
}

export async function adminListDraftEventsForCatalog(pool: Pool) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT e.id, e.title, e.status, e.organizer_user_id, u.email AS organizer_email, e.created_at
     FROM events e
     INNER JOIN users u ON u.id = e.organizer_user_id
     WHERE e.status = 'draft'
     ORDER BY e.id DESC
     LIMIT 200`
  );
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    status: String(r.status),
    organizerUserId: String(r.organizer_user_id),
    organizerEmail: String(r.organizer_email),
    createdAt: r.created_at,
  }));
}

export async function adminListDraftServicesForCatalog(pool: Pool) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.title, s.status, s.provider_user_id, u.email AS provider_email, s.created_at
     FROM services s
     INNER JOIN users u ON u.id = s.provider_user_id
     WHERE s.status = 'draft'
     ORDER BY s.id DESC
     LIMIT 200`
  );
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    status: String(r.status),
    providerUserId: String(r.provider_user_id),
    providerEmail: String(r.provider_email),
    createdAt: r.created_at,
  }));
}

export async function adminPublishDraftEvent(pool: Pool, eventId: bigint): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE events SET status = 'published', published_at = COALESCE(published_at, NOW())
     WHERE id = ? AND status = 'draft'`,
    [eventId]
  );
  return r.affectedRows > 0;
}

export async function adminPublishDraftService(pool: Pool, serviceId: bigint): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE services SET status = 'published' WHERE id = ? AND status = 'draft'",
    [serviceId]
  );
  return r.affectedRows > 0;
}

