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
  /** Uploaded listing hero image (`{apiPrefix}/static/uploads/services/...`) */
  cover_image_url?: string | null;
  /** JSON array of gallery URLs */
  image_urls?: unknown;
  service_area?: string | null;
  lead_time_days?: number | null;
  delivery_notes?: string | null;
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

/** Parses services.image_urls JSON column into URL strings. */
export function parseServiceImageUrls(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw) as unknown;
      return Array.isArray(j) ? j.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
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
    clauses.push(
      "(s.title LIKE ? OR s.description LIKE ? OR COALESCE(s.service_area,'') LIKE ? OR COALESCE(s.delivery_notes,'') LIKE ?)"
    );
    const q = `%${opts.search.trim()}%`;
    params.push(q, q, q, q);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.provider_user_id, s.category_id, s.event_id, s.title, s.description, s.price_minor, s.currency,
            s.portfolio_urls, s.cover_image_url, s.image_urls, s.service_area, s.lead_time_days, s.delivery_notes,
            s.status, c.name AS category_name, p.company_name, p.years_in_business,
            (SELECT ROUND(AVG(opr.stars), 2) FROM organizer_provider_ratings opr WHERE opr.provider_user_id = s.provider_user_id) AS organizer_rating_avg,
            (SELECT COUNT(*) FROM organizer_provider_ratings opr WHERE opr.provider_user_id = s.provider_user_id) AS organizer_rating_count
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

export async function appendServiceImageUrl(pool: Pool, serviceId: bigint, providerUserId: bigint, url: string): Promise<boolean> {
  const svc = await findServiceForProvider(pool, serviceId, providerUserId);
  if (!svc) return false;
  const row = svc as ServiceRow;
  const cur = parseServiceImageUrls(row.image_urls);
  if (!cur.includes(url)) cur.push(url);
  await pool.query<ResultSetHeader>(
    `UPDATE services SET
       image_urls = ?,
       cover_image_url = CASE WHEN COALESCE(TRIM(cover_image_url), '') = '' THEN ? ELSE cover_image_url END
     WHERE id = ? AND provider_user_id = ?`,
    [JSON.stringify(cur), url, serviceId, providerUserId]
  );
  return true;
}

export async function removeServiceGalleryUrl(
  pool: Pool,
  serviceId: bigint,
  providerUserId: bigint,
  url: string
): Promise<boolean> {
  const svc = await findServiceForProvider(pool, serviceId, providerUserId);
  if (!svc) return false;
  const row = svc as ServiceRow;
  const cur = parseServiceImageUrls(row.image_urls).filter((u) => u !== url);
  let nextCover: string | null = row.cover_image_url != null ? String(row.cover_image_url) : null;
  if (nextCover === url) nextCover = cur.length > 0 ? cur[0]! : null;
  await pool.query<ResultSetHeader>(
    `UPDATE services SET image_urls = ?, cover_image_url = ? WHERE id = ? AND provider_user_id = ?`,
    [cur.length ? JSON.stringify(cur) : null, nextCover, serviceId, providerUserId]
  );
  return true;
}

export async function findPublishedServiceById(pool: Pool, id: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.provider_user_id, s.category_id, s.event_id, s.title, s.description, s.price_minor, s.currency,
            s.portfolio_urls, s.cover_image_url, s.image_urls, s.service_area, s.lead_time_days, s.delivery_notes,
            s.status, c.name AS category_name, p.company_name, p.tagline, p.city, p.state,
            p.years_in_business,
            (SELECT ROUND(AVG(opr.stars), 2) FROM organizer_provider_ratings opr WHERE opr.provider_user_id = s.provider_user_id) AS organizer_rating_avg,
            (SELECT COUNT(*) FROM organizer_provider_ratings opr WHERE opr.provider_user_id = s.provider_user_id) AS organizer_rating_count
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
    "SELECT user_id, company_name, tagline, city, state, portfolio_urls, public_slug, booking_enabled, years_in_business FROM service_provider_profiles WHERE user_id = ?",
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
    yearsInBusiness?: number | null;
  }
) {
  await pool.query<ResultSetHeader>(
    `INSERT INTO service_provider_profiles (user_id, company_name, tagline, city, state, portfolio_urls, booking_enabled, public_slug, years_in_business)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       company_name = VALUES(company_name),
       tagline = VALUES(tagline),
       city = VALUES(city),
       state = VALUES(state),
       portfolio_urls = VALUES(portfolio_urls),
       booking_enabled = VALUES(booking_enabled),
       public_slug = VALUES(public_slug),
       years_in_business = VALUES(years_in_business)`,
    [
      userId,
      input.companyName,
      input.tagline ?? null,
      input.city ?? null,
      input.state ?? null,
      input.portfolioUrls != null ? JSON.stringify(input.portfolioUrls) : null,
      input.bookingEnabled !== false ? 1 : 0,
      input.publicSlug ?? null,
      input.yearsInBusiness ?? null,
    ]
  );
}

export async function listServicesForProvider(pool: Pool, providerUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.category_id, s.event_id, s.title, s.description, s.price_minor, s.currency, s.portfolio_urls,
            s.cover_image_url, s.image_urls, s.service_area, s.lead_time_days, s.delivery_notes,
            s.status, s.updated_at, c.name AS category_name
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
    serviceArea?: string | null;
    leadTimeDays?: number | null;
    deliveryNotes?: string | null;
    status: "draft" | "published";
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO services (provider_user_id, category_id, event_id, title, description, price_minor, currency, portfolio_urls,
                          service_area, lead_time_days, delivery_notes, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.providerUserId,
      input.categoryId,
      input.eventId,
      input.title,
      input.description,
      input.priceMinor,
      input.currency,
      input.portfolioUrls != null ? JSON.stringify(input.portfolioUrls) : null,
      input.serviceArea ?? null,
      input.leadTimeDays ?? null,
      input.deliveryNotes ?? null,
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
    coverImageUrl: string | null;
    serviceArea: string | null;
    leadTimeDays: number | null;
    deliveryNotes: string | null;
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
  if (patch.coverImageUrl !== undefined) {
    sets.push("cover_image_url = ?");
    vals.push(patch.coverImageUrl);
  }
  if (patch.serviceArea !== undefined) {
    sets.push("service_area = ?");
    vals.push(patch.serviceArea);
  }
  if (patch.leadTimeDays !== undefined) {
    sets.push("lead_time_days = ?");
    vals.push(patch.leadTimeDays);
  }
  if (patch.deliveryNotes !== undefined) {
    sets.push("delivery_notes = ?");
    vals.push(patch.deliveryNotes);
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
  input: { serviceId: bigint; fromUserId: bigint; message: string; contextEventId?: bigint | null }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    "INSERT INTO service_requests (service_id, from_user_id, message, context_event_id) VALUES (?,?,?,?)",
    [input.serviceId, input.fromUserId, input.message, input.contextEventId ?? null]
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
            r.context_event_id,
            s.title AS service_title, u.email AS from_email, u.full_name AS from_name,
            e.title AS context_event_title, e.venue_name AS context_event_venue,
            e.starts_at AS context_event_starts_at, e.ends_at AS context_event_ends_at,
            lb.id AS latest_booking_id, lb.status AS latest_booking_status,
            sc.status AS contract_status, sc.id AS contract_id, sc.accepted_at AS contract_accepted_at,
            sc.service_description AS contract_service_description, sc.duration_days AS contract_duration_days,
            sc.people_count AS contract_people_count
     FROM service_requests r
     INNER JOIN services s ON s.id = r.service_id
     INNER JOIN users u ON u.id = r.from_user_id
     LEFT JOIN events e ON e.id = r.context_event_id
     LEFT JOIN service_bookings lb ON lb.id = (
       SELECT MAX(sb.id) FROM service_bookings sb WHERE sb.service_request_id = r.id
     )
     LEFT JOIN service_request_contracts sc ON sc.service_request_id = r.id
     WHERE ${clauses.join(" AND ")}
     ORDER BY r.id DESC`,
    params
  );
  return rows;
}

export async function listRequestsByCustomer(pool: Pool, userId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id, r.service_id, r.from_user_id, r.message, r.status, r.provider_response, r.created_at,
            r.context_event_id,
            s.title AS service_title, s.provider_user_id,
            COALESCE(sp.company_name, pu.full_name, pu.email) AS provider_display_name,
            e.title AS context_event_title, e.venue_name AS context_event_venue,
            e.starts_at AS context_event_starts_at, e.ends_at AS context_event_ends_at,
            lb.id AS latest_booking_id, lb.status AS latest_booking_status,
            sc.status AS contract_status, sc.id AS contract_id, sc.accepted_at AS contract_accepted_at,
            sc.service_description AS contract_service_description
     FROM service_requests r
     INNER JOIN services s ON s.id = r.service_id
     INNER JOIN users pu ON pu.id = s.provider_user_id
     LEFT JOIN service_provider_profiles sp ON sp.user_id = s.provider_user_id
     LEFT JOIN events e ON e.id = r.context_event_id
     LEFT JOIN service_bookings lb ON lb.id = (
       SELECT MAX(sb.id) FROM service_bookings sb WHERE sb.service_request_id = r.id
     )
     LEFT JOIN service_request_contracts sc ON sc.service_request_id = r.id
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

/** Returns row if user is the enquirer or the listing provider. */
export async function getServiceRequestIfParticipant(pool: Pool, requestId: bigint, userId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id, r.service_id, r.from_user_id, r.message, r.status, r.created_at,
            r.context_event_id,
            s.provider_user_id, s.title AS service_title, s.description AS service_description,
            sc.name AS category_name,
            cu.full_name AS customer_name, cu.email AS customer_email,
            COALESCE(sp.company_name, pu.full_name, pu.email) AS provider_display_name,
            p.years_in_business AS provider_years_in_business,
            e.title AS context_event_title, e.venue_name AS context_event_venue,
            e.starts_at AS context_event_starts_at, e.ends_at AS context_event_ends_at
     FROM service_requests r
     INNER JOIN services s ON s.id = r.service_id
     INNER JOIN service_categories sc ON sc.id = s.category_id
     INNER JOIN users cu ON cu.id = r.from_user_id
     INNER JOIN users pu ON pu.id = s.provider_user_id
     LEFT JOIN service_provider_profiles sp ON sp.user_id = s.provider_user_id
     LEFT JOIN service_provider_profiles p ON p.user_id = s.provider_user_id
     LEFT JOIN events e ON e.id = r.context_event_id
     WHERE r.id = ? AND (r.from_user_id = ? OR s.provider_user_id = ?)`,
    [requestId, userId, userId]
  );
  return rows.length ? rows[0] : null;
}

export async function listServiceRequestMessages(pool: Pool, requestId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT m.id, m.from_user_id, m.body, m.created_at, u.full_name AS from_name
     FROM service_request_messages m
     INNER JOIN users u ON u.id = m.from_user_id
     WHERE m.service_request_id = ?
     ORDER BY m.id ASC`,
    [requestId]
  );
  return rows;
}

export async function insertServiceRequestMessage(
  pool: Pool,
  input: { requestId: bigint; fromUserId: bigint; body: string }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO service_request_messages (service_request_id, from_user_id, body) VALUES (?,?,?)`,
    [input.requestId, input.fromUserId, input.body]
  );
  return BigInt(r.insertId);
}

export async function touchServiceRequestInProgress(pool: Pool, requestId: bigint): Promise<void> {
  await pool.query(
    `UPDATE service_requests SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'open'`,
    [requestId]
  );
}

export async function organizerHasEnquiredWithProvider(
  pool: Pool,
  organizerUserId: bigint,
  providerUserId: bigint
): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS o
     FROM service_requests r
     INNER JOIN services s ON s.id = r.service_id
     WHERE r.from_user_id = ? AND s.provider_user_id = ?
     LIMIT 1`,
    [organizerUserId, providerUserId]
  );
  return rows.length > 0;
}

export async function upsertOrganizerProviderRating(
  pool: Pool,
  input: { organizerUserId: bigint; providerUserId: bigint; stars: number; comment: string | null }
): Promise<void> {
  await pool.query(
    `INSERT INTO organizer_provider_ratings (organizer_user_id, provider_user_id, stars, comment)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE stars = VALUES(stars), comment = VALUES(comment), updated_at = CURRENT_TIMESTAMP`,
    [input.organizerUserId, input.providerUserId, input.stars, input.comment]
  );
}

export async function getOrganizerProviderRatingRow(
  pool: Pool,
  organizerUserId: bigint,
  providerUserId: bigint
): Promise<{ stars: number; comment: string | null } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT stars, comment FROM organizer_provider_ratings WHERE organizer_user_id = ? AND provider_user_id = ?`,
    [organizerUserId, providerUserId]
  );
  if (!rows.length) return null;
  const row = rows[0]!;
  return { stars: Number(row.stars), comment: row.comment != null ? String(row.comment) : null };
}

export async function getOrganizerRatingAggregateForProvider(
  pool: Pool,
  providerUserId: bigint
): Promise<{ avg: number | null; count: number }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ROUND(AVG(stars), 2) AS avg_stars, COUNT(*) AS cnt FROM organizer_provider_ratings WHERE provider_user_id = ?`,
    [providerUserId]
  );
  const r = rows[0];
  const cnt = r?.cnt != null ? Number(r.cnt) : 0;
  const rawAvg = r?.avg_stars != null ? Number(r.avg_stars) : null;
  return { avg: cnt > 0 && rawAvg != null && !Number.isNaN(rawAvg) ? rawAvg : null, count: cnt };
}

export async function listOrganizerRatingsReceivedByProvider(pool: Pool, providerUserId: bigint, limit = 100) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT o.stars, o.comment, o.created_at, o.updated_at, u.full_name AS organizer_name
     FROM organizer_provider_ratings o
     INNER JOIN users u ON u.id = o.organizer_user_id
     WHERE o.provider_user_id = ?
     ORDER BY o.updated_at DESC
     LIMIT ?`,
    [providerUserId, limit]
  );
  return rows;
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

export async function listBookingsForProvider(
  pool: Pool,
  providerUserId: bigint,
  opts?: { contextEventId?: bigint }
) {
  const clauses = ["b.provider_user_id = ?"];
  const params: unknown[] = [providerUserId];
  if (opts?.contextEventId != null) {
    clauses.push("r.context_event_id = ?");
    params.push(opts.contextEventId);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT b.*, s.title AS service_title, u.email AS customer_email, u.full_name AS customer_name,
            r.id AS service_request_id, r.context_event_id,
            e.title AS context_event_title
     FROM service_bookings b
     INNER JOIN services s ON s.id = b.service_id
     INNER JOIN users u ON u.id = b.customer_user_id
     LEFT JOIN service_requests r ON r.id = b.service_request_id
     LEFT JOIN events e ON e.id = r.context_event_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY b.id DESC`,
    params
  );
  return rows;
}

/** Enquiries + latest booking for one organizer fair (organizer is the enquirer). */
export async function listEventMarketplaceDeals(
  pool: Pool,
  eventId: bigint,
  organizerUserId: bigint
) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id AS request_id, r.status AS request_status, r.message, r.created_at AS enquiry_created_at,
            b.id AS booking_id, b.status AS booking_status, b.amount_minor, b.currency,
            b.updated_at AS booking_updated_at, b.created_at AS booking_created_at,
            c.id AS contract_id, c.status AS contract_status, c.accepted_at AS contract_accepted_at,
            c.service_description AS contract_service_description, c.duration_days AS contract_duration_days,
            c.people_count AS contract_people_count, c.manpower_available AS contract_manpower_available,
            s.id AS service_id, s.title AS service_title, s.provider_user_id,
            COALESCE(sp.company_name, pu.full_name, pu.email) AS provider_display_name,
            e.title AS context_event_title, e.venue_name AS context_event_venue,
            e.starts_at AS context_event_starts_at, e.ends_at AS context_event_ends_at
     FROM service_requests r
     INNER JOIN services s ON s.id = r.service_id
     INNER JOIN users pu ON pu.id = s.provider_user_id
     LEFT JOIN service_provider_profiles sp ON sp.user_id = s.provider_user_id
     LEFT JOIN service_bookings b ON b.id = (
       SELECT MAX(sb.id) FROM service_bookings sb WHERE sb.service_request_id = r.id
     )
     LEFT JOIN service_request_contracts c ON c.service_request_id = r.id
     LEFT JOIN events e ON e.id = r.context_event_id
     WHERE r.context_event_id = ? AND r.from_user_id = ?
     ORDER BY
       CASE WHEN c.status = 'accepted' THEN 0 WHEN c.status = 'pending_acceptance' THEN 1 WHEN b.status = 'completed' THEN 2 WHEN b.id IS NOT NULL THEN 3 ELSE 4 END,
       COALESCE(b.updated_at, r.updated_at) DESC`,
    [eventId, organizerUserId]
  );
  return rows;
}

/** All accepted contracts across organizer's fairs. */
export async function listOrganizerAcceptedContracts(pool: Pool, organizerUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id AS contract_id, c.accepted_at, c.service_description, c.duration_days, c.people_count,
            r.id AS request_id, s.title AS service_title,
            COALESCE(sp.company_name, pu.full_name, pu.email) AS provider_display_name,
            e.id AS event_id, e.title AS event_title, e.venue_name AS event_venue,
            e.starts_at AS event_starts_at, e.ends_at AS event_ends_at
     FROM service_request_contracts c
     INNER JOIN service_requests r ON r.id = c.service_request_id
     INNER JOIN services s ON s.id = r.service_id
     INNER JOIN users pu ON pu.id = s.provider_user_id
     LEFT JOIN service_provider_profiles sp ON sp.user_id = s.provider_user_id
     LEFT JOIN events e ON e.id = r.context_event_id
     WHERE c.organizer_user_id = ? AND c.status = 'accepted'
     ORDER BY c.accepted_at DESC`,
    [organizerUserId]
  );
  return rows;
}

/** Accepted contracts for a service provider (organiser is the customer). */
export async function listProviderAcceptedContracts(pool: Pool, providerUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id AS contract_id, c.accepted_at, c.service_description, c.duration_days, c.people_count,
            c.manpower_available,
            r.id AS request_id, s.id AS service_id, s.title AS service_title,
            COALESCE(ou.full_name, ou.email) AS organizer_display_name,
            e.id AS event_id, e.title AS event_title, e.venue_name AS event_venue,
            e.starts_at AS event_starts_at, e.ends_at AS event_ends_at,
            b.id AS booking_id, b.status AS booking_status, b.amount_minor, b.currency
     FROM service_request_contracts c
     INNER JOIN service_requests r ON r.id = c.service_request_id
     INNER JOIN services s ON s.id = r.service_id
     INNER JOIN users ou ON ou.id = c.organizer_user_id
     LEFT JOIN events e ON e.id = r.context_event_id
     LEFT JOIN service_bookings b ON b.id = (
       SELECT MAX(sb.id) FROM service_bookings sb WHERE sb.service_request_id = r.id
     )
     WHERE c.provider_user_id = ? AND c.status = 'accepted'
     ORDER BY c.accepted_at DESC`,
    [providerUserId]
  );
  return rows;
}

/** Full accepted-contract detail for provider (organiser + fair + optional booking). */
export async function getProviderAcceptedContractDetail(
  pool: Pool,
  contractId: bigint,
  providerUserId: bigint
) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.*, r.id AS request_id, r.message AS enquiry_message, r.status AS request_status,
            ou.id AS organizer_user_id, ou.full_name AS organizer_name, ou.email AS organizer_email,
            ou.phone AS organizer_phone,
            s.id AS service_id, s.title AS service_title, s.description AS service_description,
            sc.name AS category_name,
            e.id AS event_id, e.title AS event_title, e.venue_name AS event_venue,
            e.starts_at AS event_starts_at, e.ends_at AS event_ends_at,
            b.id AS booking_id, b.status AS booking_status, b.amount_minor AS booking_amount_minor,
            b.currency AS booking_currency, b.scheduled_at AS booking_scheduled_at,
            b.created_at AS booking_created_at
     FROM service_request_contracts c
     INNER JOIN service_requests r ON r.id = c.service_request_id
     INNER JOIN services s ON s.id = r.service_id
     INNER JOIN service_categories sc ON sc.id = s.category_id
     INNER JOIN users ou ON ou.id = c.organizer_user_id
     LEFT JOIN events e ON e.id = r.context_event_id
     LEFT JOIN service_bookings b ON b.id = (
       SELECT MAX(sb.id) FROM service_bookings sb WHERE sb.service_request_id = r.id
     )
     WHERE c.id = ? AND c.provider_user_id = ? AND c.status = 'accepted'`,
    [contractId, providerUserId]
  );
  return rows.length ? rows[0] : null;
}

export type MachineryItem = { name: string; count: number; details?: string | null };

export function parseMachineryJson(raw: unknown): MachineryItem[] {
  if (raw == null) return [];
  if (typeof raw === "string") {
    try {
      return parseMachineryJson(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      if (!x || typeof x !== "object") return null;
      const o = x as Record<string, unknown>;
      const name = String(o.name ?? "").trim();
      if (!name) return null;
      return {
        name,
        count: Math.max(0, Number(o.count) || 0),
        details: o.details != null ? String(o.details) : null,
      };
    })
    .filter((x): x is MachineryItem => x != null);
}

export async function findContractByRequestId(pool: Pool, requestId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM service_request_contracts
     WHERE service_request_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [requestId]
  );
  return rows.length ? rows[0] : null;
}

export function normalizeContractStatus(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

export async function deleteContractForRequest(pool: Pool, requestId: bigint) {
  await pool.query("DELETE FROM service_request_contracts WHERE service_request_id = ?", [requestId]);
}

export async function insertServiceRequestContract(
  pool: Pool,
  input: {
    serviceRequestId: bigint;
    organizerUserId: bigint;
    providerUserId: bigint;
    serviceDescription: string;
    durationDays: number;
    peopleCount: number;
    organizerNotes: string | null;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO service_request_contracts (
       service_request_id, organizer_user_id, provider_user_id, status,
       service_description, duration_days, people_count, organizer_notes
     ) VALUES (?,?,?,'pending_acceptance',?,?,?,?)`,
    [
      input.serviceRequestId,
      input.organizerUserId,
      input.providerUserId,
      input.serviceDescription,
      input.durationDays,
      input.peopleCount,
      input.organizerNotes,
    ]
  );
  return BigInt(r.insertId);
}

export async function acceptServiceRequestContract(
  pool: Pool,
  requestId: bigint,
  providerUserId: bigint,
  input: {
    manpowerAvailable: number;
    machinery: MachineryItem[];
    providerNotes: string | null;
  }
): Promise<boolean> {
  const machineryJson = JSON.stringify(input.machinery);
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE service_request_contracts c
     INNER JOIN service_requests r ON r.id = c.service_request_id
     INNER JOIN services s ON s.id = r.service_id
     SET c.status = 'accepted',
         c.manpower_available = ?,
         c.machinery_json = ?,
         c.provider_notes = ?,
         c.accepted_at = COALESCE(c.accepted_at, CURRENT_TIMESTAMP),
         r.status = 'closed',
         r.updated_at = CURRENT_TIMESTAMP
     WHERE c.id = (
       SELECT id FROM (
         SELECT c2.id FROM service_request_contracts c2
         WHERE c2.service_request_id = ? AND c2.status = 'pending_acceptance'
         ORDER BY c2.id DESC
         LIMIT 1
       ) AS latest_pending
     )
     AND c.service_request_id = ?
     AND s.provider_user_id = ?`,
    [input.manpowerAvailable, machineryJson, input.providerNotes, requestId, requestId, providerUserId]
  );
  return r.affectedRows === 1;
}

export async function declineServiceRequestContract(
  pool: Pool,
  requestId: bigint,
  providerUserId: bigint,
  providerNotes: string | null
): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE service_request_contracts c
     INNER JOIN service_requests r ON r.id = c.service_request_id
     INNER JOIN services s ON s.id = r.service_id
     SET c.status = 'declined',
         c.provider_notes = COALESCE(?, c.provider_notes),
         r.updated_at = CURRENT_TIMESTAMP
     WHERE c.id = (
       SELECT id FROM (
         SELECT c2.id FROM service_request_contracts c2
         WHERE c2.service_request_id = ? AND c2.status = 'pending_acceptance'
         ORDER BY c2.id DESC
         LIMIT 1
       ) AS latest_pending
     )
     AND c.service_request_id = ?
     AND s.provider_user_id = ?`,
    [providerNotes, requestId, requestId, providerUserId]
  );
  return r.affectedRows === 1;
}

export async function closeServiceRequestForCompletedBooking(
  pool: Pool,
  bookingId: bigint,
  providerUserId: bigint
) {
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE service_requests r
     INNER JOIN service_bookings b ON b.service_request_id = r.id
     INNER JOIN services s ON s.id = b.service_id
     SET r.status = 'closed', r.updated_at = CURRENT_TIMESTAMP
     WHERE b.id = ? AND s.provider_user_id = ? AND r.status <> 'closed'`,
    [bookingId, providerUserId]
  );
  return r.affectedRows > 0;
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

/** Basis points taken from the event organizer's active ORGANIZER plan (stall bookings). 0 if none. */
export async function getStallBookingCommissionBpsForEvent(pool: Pool, eventId: bigint): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.stall_booking_commission_bps AS bps
     FROM events e
     INNER JOIN subscriptions s
       ON s.user_id = e.organizer_user_id AND s.status = 'active' AND s.ends_at > NOW()
     INNER JOIN subscription_plans p ON p.id = s.plan_id AND UPPER(p.target_role_code) = 'ORGANIZER'
     WHERE e.id = ?
     ORDER BY s.ends_at DESC
     LIMIT 1`,
    [eventId]
  );
  if (!rows.length) return 0;
  return Number(rows[0].bps ?? 0);
}

export async function countProviderServices(
  pool: Pool,
  providerUserId: bigint,
  scope: "all" | "published"
): Promise<number> {
  const where = scope === "published" ? "provider_user_id = ? AND status = 'published'" : "provider_user_id = ?";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM services WHERE ${where}`,
    [providerUserId]
  );
  return Number(rows[0]?.c ?? 0);
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
    `SELECT id, name, description, price_minor, duration_days, active, target_role_code, limitations_json, stall_booking_commission_bps, created_at
     FROM subscription_plans ORDER BY id ASC`
  );
  return rows;
}

export async function findSubscriptionPlanById(pool: Pool, planId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, description, price_minor, duration_days, active, target_role_code, limitations_json, stall_booking_commission_bps
     FROM subscription_plans WHERE id = ? LIMIT 1`,
    [planId]
  );
  return rows.length ? rows[0] : null;
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
    targetRoleCode: string;
    limitationsJson: Record<string, unknown> | null;
    stallBookingCommissionBps: number;
  }
) {
  const rc = input.targetRoleCode.toUpperCase();
  const bps = rc === "SERVICE_PROVIDER" ? 0 : input.stallBookingCommissionBps;
  if (input.id != null) {
    await pool.query(
      `UPDATE subscription_plans SET name=?, description=?, price_minor=?, duration_days=?, active=?, target_role_code=?, limitations_json=?, stall_booking_commission_bps=? WHERE id=?`,
      [
        input.name,
        input.description,
        input.priceMinor,
        input.durationDays,
        input.active ? 1 : 0,
        rc,
        input.limitationsJson != null ? JSON.stringify(input.limitationsJson) : null,
        bps,
        input.id,
      ]
    );
    return input.id;
  }
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO subscription_plans (name, description, price_minor, duration_days, active, target_role_code, limitations_json, stall_booking_commission_bps)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      input.name,
      input.description,
      input.priceMinor,
      input.durationDays,
      input.active ? 1 : 0,
      rc,
      input.limitationsJson != null ? JSON.stringify(input.limitationsJson) : null,
      bps,
    ]
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
    `SELECT s.id, s.plan_id, s.starts_at, s.ends_at, p.name AS plan_name, p.target_role_code, p.limitations_json, p.price_minor, p.stall_booking_commission_bps
     FROM subscriptions s
     INNER JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.user_id = ? AND s.status = 'active' AND s.ends_at > NOW()
     ORDER BY s.ends_at DESC LIMIT 1`,
    [userId]
  );
  return rows.length ? rows[0] : null;
}

/** Active subscription whose plan targets the given role (e.g. ORGANIZER). */
export async function findActiveSubscriptionForRole(pool: Pool, userId: bigint, roleCode: string) {
  const rc = roleCode.toUpperCase();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.plan_id, s.starts_at, s.ends_at, p.name AS plan_name, p.target_role_code, p.limitations_json, p.price_minor, p.stall_booking_commission_bps
     FROM subscriptions s
     INNER JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.user_id = ? AND s.status = 'active' AND s.ends_at > NOW() AND p.target_role_code = ?
     ORDER BY s.ends_at DESC LIMIT 1`,
    [userId, rc]
  );
  return rows.length ? rows[0] : null;
}

export async function expireActiveSubscriptionsForUser(pool: Pool, userId: bigint): Promise<void> {
  await pool.query(`UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active'`, [userId]);
}

export async function expireActiveSubscriptionsForUserAndRole(
  pool: Pool,
  userId: bigint,
  targetRoleCode: string
): Promise<void> {
  const rc = targetRoleCode.toUpperCase();
  await pool.query(
    `UPDATE subscriptions s
     INNER JOIN subscription_plans p ON p.id = s.plan_id
     SET s.status = 'expired'
     WHERE s.user_id = ? AND s.status = 'active' AND p.target_role_code = ?`,
    [userId, rc]
  );
}

export async function listActivePlansForRole(pool: Pool, roleCode: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, description, price_minor, duration_days, target_role_code, limitations_json, stall_booking_commission_bps
     FROM subscription_plans WHERE active = 1 AND target_role_code = ?
     ORDER BY price_minor ASC, id ASC`,
    [roleCode.toUpperCase()]
  );
  return rows;
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
