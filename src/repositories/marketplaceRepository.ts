import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type ServiceRow = {
  id: bigint;
  provider_user_id: bigint;
  category_id: number;
  event_id: bigint | null;
  title: string;
  description: string | null;
  price_minor: bigint;
  currency: string;
  portfolio_urls: unknown;
  status: string;
};

export async function listServiceCategories(pool: Pool) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, name, slug, sort_order FROM service_categories ORDER BY sort_order ASC, id ASC"
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    slug: String(r.slug),
    sortOrder: Number(r.sort_order),
  }));
}

export async function listPublishedServices(
  pool: Pool,
  opts: { categoryId?: number; search?: string }
) {
  const clauses = ["s.status = 'published'"];
  const params: unknown[] = [];
  if (opts.categoryId != null) {
    clauses.push("s.category_id = ?");
    params.push(opts.categoryId);
  }
  if (opts.search?.trim()) {
    clauses.push("(s.title LIKE ? OR s.description LIKE ?)");
    const q = `%${opts.search.trim()}%`;
    params.push(q, q);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.provider_user_id, s.category_id, s.event_id, s.title, s.description, s.price_minor, s.currency,
            s.portfolio_urls, s.status, c.name AS category_name, p.company_name
     FROM services s
     INNER JOIN service_categories c ON c.id = s.category_id
     LEFT JOIN service_provider_profiles p ON p.user_id = s.provider_user_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY s.updated_at DESC
     LIMIT 200`,
    params
  );
  return rows;
}

export async function findPublishedServiceById(pool: Pool, id: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.provider_user_id, s.category_id, s.event_id, s.title, s.description, s.price_minor, s.currency,
            s.portfolio_urls, s.status, c.name AS category_name, p.company_name, p.tagline, p.city, p.state
     FROM services s
     INNER JOIN service_categories c ON c.id = s.category_id
     LEFT JOIN service_provider_profiles p ON p.user_id = s.provider_user_id
     WHERE s.id = ? AND s.status = 'published'`,
    [id]
  );
  if (!rows.length) return null;
  return rows[0];
}

export async function getProviderProfile(pool: Pool, userId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT user_id, company_name, tagline, city, state, portfolio_urls, public_slug, booking_enabled FROM service_provider_profiles WHERE user_id = ?",
    [userId]
  );
  return rows.length ? rows[0] : null;
}

export async function upsertProviderProfile(
  pool: Pool,
  userId: bigint,
  input: {
    companyName: string;
    tagline?: string | null;
    city?: string | null;
    state?: string | null;
    portfolioUrls?: unknown;
    bookingEnabled?: boolean;
    publicSlug?: string | null;
  }
) {
  await pool.query<ResultSetHeader>(
    `INSERT INTO service_provider_profiles (user_id, company_name, tagline, city, state, portfolio_urls, booking_enabled, public_slug)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       company_name = VALUES(company_name),
       tagline = VALUES(tagline),
       city = VALUES(city),
       state = VALUES(state),
       portfolio_urls = VALUES(portfolio_urls),
       booking_enabled = VALUES(booking_enabled),
       public_slug = VALUES(public_slug)`,
    [
      userId,
      input.companyName,
      input.tagline ?? null,
      input.city ?? null,
      input.state ?? null,
      input.portfolioUrls != null ? JSON.stringify(input.portfolioUrls) : null,
      input.bookingEnabled !== false ? 1 : 0,
      input.publicSlug ?? null,
    ]
  );
}

export async function listServicesForProvider(pool: Pool, providerUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.category_id, s.event_id, s.title, s.description, s.price_minor, s.currency, s.portfolio_urls, s.status, s.updated_at,
            c.name AS category_name
     FROM services s
     INNER JOIN service_categories c ON c.id = s.category_id
     WHERE s.provider_user_id = ?
     ORDER BY s.id DESC`,
    [providerUserId]
  );
  return rows;
}

export async function insertService(
  pool: Pool,
  input: {
    providerUserId: bigint;
    categoryId: number;
    eventId: bigint | null;
    title: string;
    description: string | null;
    priceMinor: bigint;
    currency: string;
    portfolioUrls: unknown | null;
    status: "draft" | "published";
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO services (provider_user_id, category_id, event_id, title, description, price_minor, currency, portfolio_urls, status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      input.providerUserId,
      input.categoryId,
      input.eventId,
      input.title,
      input.description,
      input.priceMinor,
      input.currency,
      input.portfolioUrls != null ? JSON.stringify(input.portfolioUrls) : null,
      input.status,
    ]
  );
  return BigInt(r.insertId);
}

export async function updateService(
  pool: Pool,
  serviceId: bigint,
  providerUserId: bigint,
  patch: Partial<{
    categoryId: number;
    eventId: bigint | null;
    title: string;
    description: string | null;
    priceMinor: bigint;
    portfolioUrls: unknown | null;
    status: "draft" | "published";
  }>
) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.categoryId != null) {
    sets.push("category_id = ?");
    vals.push(patch.categoryId);
  }
  if (patch.eventId !== undefined) {
    sets.push("event_id = ?");
    vals.push(patch.eventId);
  }
  if (patch.title != null) {
    sets.push("title = ?");
    vals.push(patch.title);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    vals.push(patch.description);
  }
  if (patch.priceMinor != null) {
    sets.push("price_minor = ?");
    vals.push(patch.priceMinor);
  }
  if (patch.portfolioUrls !== undefined) {
    sets.push("portfolio_urls = ?");
    vals.push(patch.portfolioUrls != null ? JSON.stringify(patch.portfolioUrls) : null);
  }
  if (patch.status != null) {
    sets.push("status = ?");
    vals.push(patch.status);
  }
  if (!sets.length) return false;
  vals.push(serviceId, providerUserId);
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE services SET ${sets.join(", ")} WHERE id = ? AND provider_user_id = ?`,
    vals
  );
  return r.affectedRows === 1;
}

export async function findServiceForProvider(pool: Pool, serviceId: bigint, providerUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM services WHERE id = ? AND provider_user_id = ?",
    [serviceId, providerUserId]
  );
  return rows.length ? (rows[0] as ServiceRow) : null;
}

export async function findServiceById(pool: Pool, serviceId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM services WHERE id = ?", [serviceId]);
  return rows.length ? (rows[0] as ServiceRow) : null;
}

export async function insertServiceRequest(
  pool: Pool,
  input: { serviceId: bigint; fromUserId: bigint; message: string }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    "INSERT INTO service_requests (service_id, from_user_id, message) VALUES (?,?,?)",
    [input.serviceId, input.fromUserId, input.message]
  );
  return BigInt(r.insertId);
}

export async function listRequestsForProvider(
  pool: Pool,
  providerUserId: bigint,
  opts?: { status?: "open" | "in_progress" | "closed" }
) {
  const clauses = ["s.provider_user_id = ?"];
  const params: unknown[] = [providerUserId];
  if (opts?.status) {
    clauses.push("r.status = ?");
    params.push(opts.status);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id, r.service_id, r.from_user_id, r.message, r.status, r.provider_response, r.created_at, r.updated_at,
            s.title AS service_title, u.email AS from_email, u.full_name AS from_name
     FROM service_requests r
     INNER JOIN services s ON s.id = r.service_id
     INNER JOIN users u ON u.id = r.from_user_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY r.id DESC`,
    params
  );
  return rows;
}

export async function listRequestsByCustomer(pool: Pool, userId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id, r.service_id, r.from_user_id, r.message, r.status, r.provider_response, r.created_at,
            s.title AS service_title
     FROM service_requests r
     INNER JOIN services s ON s.id = r.service_id
     WHERE r.from_user_id = ?
     ORDER BY r.id DESC`,
    [userId]
  );
  return rows;
}

export async function patchServiceRequest(
  pool: Pool,
  requestId: bigint,
  providerUserId: bigint,
  input: { status?: "open" | "in_progress" | "closed"; providerResponse?: string | null }
) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (input.status != null) {
    sets.push("r.status = ?");
    vals.push(input.status);
  }
  if (input.providerResponse !== undefined) {
    sets.push("r.provider_response = ?");
    vals.push(input.providerResponse);
  }
  if (!sets.length) return false;
  vals.push(requestId, providerUserId);
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE service_requests r
     INNER JOIN services s ON s.id = r.service_id
     SET ${sets.join(", ")}
     WHERE r.id = ? AND s.provider_user_id = ?`,
    vals
  );
  return r.affectedRows === 1;
}

export async function findRequestById(pool: Pool, id: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.*, s.provider_user_id, s.title AS service_title
     FROM service_requests r
     INNER JOIN services s ON s.id = r.service_id
     WHERE r.id = ?`,
    [id]
  );
  return rows.length ? rows[0] : null;
}

export async function insertServiceBooking(
  pool: Pool,
  input: {
    serviceRequestId: bigint | null;
    serviceId: bigint;
    customerUserId: bigint;
    providerUserId: bigint;
    scheduledAt: Date | null;
    amountMinor: bigint;
    currency: string;
    status: "pending_payment" | "confirmed" | "rejected" | "completed" | "cancelled";
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO service_bookings (service_request_id, service_id, customer_user_id, provider_user_id, scheduled_at, amount_minor, currency, status)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      input.serviceRequestId,
      input.serviceId,
      input.customerUserId,
      input.providerUserId,
      input.scheduledAt,
      input.amountMinor,
      input.currency,
      input.status,
    ]
  );
  return BigInt(r.insertId);
}

export async function findServiceBookingForUser(
  pool: Pool,
  bookingId: bigint,
  userId: bigint
) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT b.*, s.title AS service_title
     FROM service_bookings b
     INNER JOIN services s ON s.id = b.service_id
     WHERE b.id = ? AND (b.customer_user_id = ? OR b.provider_user_id = ?)`,
    [bookingId, userId, userId]
  );
  return rows.length ? rows[0] : null;
}

export async function findServiceBookingByRazorpayOrderId(pool: Pool, orderId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM service_bookings WHERE razorpay_order_id = ?",
    [orderId]
  );
  return rows.length ? rows[0] : null;
}

export async function setServiceBookingRazorpayOrder(pool: Pool, bookingId: bigint, orderId: string) {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE service_bookings SET razorpay_order_id = ? WHERE id = ? AND status = 'pending_payment'",
    [orderId, bookingId]
  );
  return r.affectedRows === 1;
}

export async function confirmServiceBookingPayment(pool: Pool, bookingId: bigint) {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE service_bookings SET status = 'confirmed' WHERE id = ? AND status = 'pending_payment'",
    [bookingId]
  );
  return r.affectedRows === 1;
}

export async function updateServiceBookingStatus(
  pool: Pool,
  bookingId: bigint,
  providerUserId: bigint,
  status: "confirmed" | "rejected" | "completed" | "cancelled"
) {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE service_bookings SET status = ? WHERE id = ? AND provider_user_id = ?",
    [status, bookingId, providerUserId]
  );
  return r.affectedRows === 1;
}

export async function patchServiceBookingAsProvider(
  pool: Pool,
  bookingId: bigint,
  providerUserId: bigint,
  patch: {
    status?: "confirmed" | "rejected" | "completed" | "cancelled";
    scheduledAt?: Date | null;
  }
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    vals.push(patch.status);
  }
  if (patch.scheduledAt !== undefined) {
    sets.push("scheduled_at = ?");
    vals.push(patch.scheduledAt);
  }
  if (!sets.length) return false;
  vals.push(bookingId, providerUserId);
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE service_bookings SET ${sets.join(", ")} WHERE id = ? AND provider_user_id = ?`,
    vals
  );
  return r.affectedRows === 1;
}

/** Payments captured for this provider's service bookings (customer is payer). */
export async function listPaymentsForProvider(pool: Pool, providerUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, p.amount_minor, p.currency, p.status, p.created_at, p.razorpay_order_id, p.razorpay_payment_id,
            p.service_booking_id, i.invoice_number, sb.service_id, s.title AS service_title
     FROM payments p
     INNER JOIN service_bookings sb ON sb.id = p.service_booking_id
     INNER JOIN services s ON s.id = sb.service_id
     WHERE sb.provider_user_id = ? AND p.service_booking_id IS NOT NULL
     ORDER BY p.created_at DESC
     LIMIT 200`,
    [providerUserId]
  );
  return rows;
}

export async function listReviewsForProvider(pool: Pool, providerUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id, r.service_id, r.booking_id, r.rating, r.comment, r.created_at,
            u.full_name AS reviewer_name, s.title AS service_title
     FROM service_reviews r
     INNER JOIN services s ON s.id = r.service_id
     INNER JOIN users u ON u.id = r.reviewer_user_id
     WHERE s.provider_user_id = ?
     ORDER BY r.id DESC
     LIMIT 200`,
    [providerUserId]
  );
  return rows;
}

export async function listBookingsForProvider(pool: Pool, providerUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT b.*, s.title AS service_title, u.email AS customer_email, u.full_name AS customer_name
     FROM service_bookings b
     INNER JOIN services s ON s.id = b.service_id
     INNER JOIN users u ON u.id = b.customer_user_id
     WHERE b.provider_user_id = ?
     ORDER BY b.id DESC`,
    [providerUserId]
  );
  return rows;
}

export async function listBookingsForCustomer(pool: Pool, customerUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT b.*, s.title AS service_title
     FROM service_bookings b
     INNER JOIN services s ON s.id = b.service_id
     WHERE b.customer_user_id = ?
     ORDER BY b.id DESC`,
    [customerUserId]
  );
  return rows;
}

export async function insertServiceReview(
  pool: Pool,
  input: { serviceId: bigint; bookingId: bigint; reviewerUserId: bigint; rating: number; comment: string | null }
) {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO service_reviews (service_id, booking_id, reviewer_user_id, rating, comment)
     VALUES (?,?,?,?,?)`,
    [input.serviceId, input.bookingId, input.reviewerUserId, input.rating, input.comment]
  );
  return BigInt(r.insertId);
}

export async function listReviewsForService(pool: Pool, serviceId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id, r.rating, r.comment, r.created_at, u.full_name AS reviewer_name
     FROM service_reviews r
     INNER JOIN users u ON u.id = r.reviewer_user_id
     WHERE r.service_id = ?
     ORDER BY r.id DESC`,
    [serviceId]
  );
  return rows;
}

export async function resolveCommissionBps(
  pool: Pool,
  input: { eventId: bigint | null; categoryId: number }
): Promise<number> {
  if (input.eventId != null) {
    const [ev] = await pool.query<RowDataPacket[]>(
      `SELECT commission_bps FROM commission_rules
       WHERE active = 1 AND scope_type = 'event' AND event_id = ? LIMIT 1`,
      [input.eventId]
    );
    if (ev.length) return Number(ev[0].commission_bps);
  }
  const [cat] = await pool.query<RowDataPacket[]>(
    `SELECT commission_bps FROM commission_rules
     WHERE active = 1 AND scope_type = 'service_category' AND service_category_id = ? LIMIT 1`,
    [input.categoryId]
  );
  if (cat.length) return Number(cat[0].commission_bps);
  const [g] = await pool.query<RowDataPacket[]>(
    `SELECT commission_bps FROM commission_rules
     WHERE active = 1 AND scope_type = 'global' LIMIT 1`
  );
  return g.length ? Number(g[0].commission_bps) : 1000;
}

export async function listCommissionRules(pool: Pool) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, scope_type, event_id, service_category_id, commission_bps, active FROM commission_rules ORDER BY id ASC"
  );
  return rows;
}

export async function upsertCommissionRule(
  pool: Pool,
  input: {
    id?: number;
    scopeType: "global" | "event" | "service_category";
    eventId: bigint | null;
    serviceCategoryId: number | null;
    commissionBps: number;
    active: boolean;
  }
) {
  if (input.id != null) {
    await pool.query(
      `UPDATE commission_rules SET scope_type=?, event_id=?, service_category_id=?, commission_bps=?, active=?
       WHERE id=?`,
      [
        input.scopeType,
        input.eventId,
        input.serviceCategoryId,
        input.commissionBps,
        input.active ? 1 : 0,
        input.id,
      ]
    );
    return BigInt(input.id);
  }
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO commission_rules (scope_type, event_id, service_category_id, commission_bps, active)
     VALUES (?,?,?,?,?)`,
    [
      input.scopeType,
      input.eventId,
      input.serviceCategoryId,
      input.commissionBps,
      input.active ? 1 : 0,
    ]
  );
  return BigInt(r.insertId);
}

export async function listSubscriptionPlans(pool: Pool) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, name, description, price_minor, duration_days, active, created_at FROM subscription_plans ORDER BY id ASC"
  );
  return rows;
}

export async function upsertSubscriptionPlan(
  pool: Pool,
  input: {
    id?: number;
    name: string;
    description: string | null;
    priceMinor: bigint;
    durationDays: number;
    active: boolean;
  }
) {
  if (input.id != null) {
    await pool.query(
      `UPDATE subscription_plans SET name=?, description=?, price_minor=?, duration_days=?, active=? WHERE id=?`,
      [
        input.name,
        input.description,
        input.priceMinor,
        input.durationDays,
        input.active ? 1 : 0,
        input.id,
      ]
    );
    return input.id;
  }
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO subscription_plans (name, description, price_minor, duration_days, active) VALUES (?,?,?,?,?)`,
    [input.name, input.description, input.priceMinor, input.durationDays, input.active ? 1 : 0]
  );
  return r.insertId;
}

export async function insertSubscription(
  pool: Pool,
  input: { userId: bigint; planId: number; startsAt: Date; endsAt: Date }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO subscriptions (user_id, plan_id, status, starts_at, ends_at) VALUES (?,?, 'active', ?, ?)`,
    [input.userId, input.planId, input.startsAt, input.endsAt]
  );
  return BigInt(r.insertId);
}

export async function findActiveSubscription(pool: Pool, userId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.plan_id, s.starts_at, s.ends_at, p.name AS plan_name
     FROM subscriptions s
     INNER JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.user_id = ? AND s.status = 'active' AND s.ends_at > NOW()
     ORDER BY s.ends_at DESC LIMIT 1`,
    [userId]
  );
  return rows.length ? rows[0] : null;
}

export async function insertRefundRecord(
  pool: Pool,
  input: {
    paymentId: bigint;
    amountMinor: bigint;
    requestedByUserId: bigint;
    notes?: string | null;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO refunds (payment_id, requested_by_user_id, amount_minor, notes, status)
     VALUES (?,?,?,?,'requested')`,
    [input.paymentId, input.requestedByUserId, input.amountMinor, input.notes ?? null]
  );
  return BigInt(r.insertId);
}

export async function listRefundsPending(pool: Pool) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id, r.payment_id, r.amount_minor, r.status, r.created_at, r.notes,
            p.razorpay_payment_id, p.payer_user_id, p.service_booking_id, p.booking_id, p.ticket_order_id
     FROM refunds r
     INNER JOIN payments p ON p.id = r.payment_id
     WHERE r.status = 'requested'
     ORDER BY r.id ASC`
  );
  return rows;
}

export async function findRefundById(pool: Pool, id: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id, r.payment_id, r.amount_minor AS refund_amount_minor, r.status,
            p.razorpay_payment_id, p.amount_minor AS payment_amount_minor
     FROM refunds r INNER JOIN payments p ON p.id = r.payment_id WHERE r.id = ?`,
    [id]
  );
  return rows.length ? rows[0] : null;
}

export async function markRefundProcessed(
  pool: Pool,
  refundId: bigint,
  razorpayRefundId: string,
  approvedByUserId: bigint
) {
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE refunds SET status = 'processed', razorpay_refund_id = ?, approved_by_user_id = ? WHERE id = ? AND status = 'requested'`,
    [razorpayRefundId, approvedByUserId, refundId]
  );
  return r.affectedRows === 1;
}

export async function markRefundRejected(pool: Pool, refundId: bigint, approvedByUserId: bigint) {
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE refunds SET status = 'rejected', approved_by_user_id = ? WHERE id = ? AND status = 'requested'`,
    [approvedByUserId, refundId]
  );
  return r.affectedRows === 1;
}

export async function deleteCommissionRuleById(pool: Pool, id: number): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>("DELETE FROM commission_rules WHERE id = ?", [id]);
  return r.affectedRows > 0;
}

export async function subscriptionPlanInUse(pool: Pool, planId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM subscriptions WHERE plan_id = ? LIMIT 1",
    [planId]
  );
  return rows.length > 0;
}

export async function deleteSubscriptionPlanById(pool: Pool, planId: number): Promise<"ok" | "in_use" | "not_found"> {
  const inUse = await subscriptionPlanInUse(pool, planId);
  if (inUse) return "in_use";
  const [r] = await pool.query<ResultSetHeader>("DELETE FROM subscription_plans WHERE id = ?", [planId]);
  return r.affectedRows > 0 ? "ok" : "not_found";
}
