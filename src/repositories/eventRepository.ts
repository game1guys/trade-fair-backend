import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type EventRow = {
  id: bigint;
  organizer_user_id: bigint;
  category_id: number | null;
  title: string;
  description: string | null;
  venue_name: string;
  venue_city: string | null;
  venue_country: string | null;
  /** Present after optional schema migration */
  venue_state?: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  starts_at: Date;
  ends_at: Date;
  is_b2b: number;
  is_b2c: number;
  tags: unknown;
  /** Present after migration 016 */
  require_booking_approval?: number;
  /** Present after migration 021 — 1 = gate QR can be scanned multiple times without consuming ticket */
  entry_qr_allow_reentry?: number;
  status: "draft" | "published" | "cancelled";
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapEvent(r: RowDataPacket): EventRow {
  return {
    ...r,
    id: BigInt(r.id as string),
    organizer_user_id: BigInt(r.organizer_user_id as string),
    category_id: r.category_id != null ? Number(r.category_id) : null,
  } as EventRow;
}

export async function insertEvent(
  pool: Pool,
  input: {
    organizerUserId: bigint;
    categoryId: number | null;
    title: string;
    description: string | null;
    venueName: string;
    venueCity: string | null;
    venueCountry: string | null;
    venueState: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    startsAt: Date;
    endsAt: Date;
    isB2b: boolean;
    isB2c: boolean;
    tags: string[] | null;
    requireBookingApproval?: boolean;
    /** When true, gate scans record valid entry each time without marking ticket used */
    entryQrAllowReentry?: boolean;
    status: "draft" | "published";
  }
): Promise<bigint> {
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO events (
      organizer_user_id, category_id, title, description, venue_name, venue_city, venue_country, venue_state, address,
      latitude, longitude, starts_at, ends_at, is_b2b, is_b2c, tags, require_booking_approval, entry_qr_allow_reentry, status, published_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.organizerUserId,
      input.categoryId,
      input.title,
      input.description,
      input.venueName,
      input.venueCity,
      input.venueCountry,
      input.venueState,
      input.address,
      input.latitude,
      input.longitude,
      input.startsAt,
      input.endsAt,
      input.isB2b ? 1 : 0,
      input.isB2c ? 1 : 0,
      input.tags ? JSON.stringify(input.tags) : null,
      input.requireBookingApproval ? 1 : 0,
      input.entryQrAllowReentry ? 1 : 0,
      input.status,
      input.status === "published" ? new Date() : null,
    ]
  );
  return BigInt(result.insertId);
}

export async function countOrganizerEvents(
  pool: Pool,
  organizerUserId: bigint,
  filter: "all_non_cancelled" | "published"
): Promise<number> {
  const clause =
    filter === "published"
      ? "status = 'published'"
      : "status IN ('draft','published')";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM events WHERE organizer_user_id = ? AND ${clause}`,
    [organizerUserId]
  );
  return Number(rows[0]?.c ?? 0);
}

export async function updateEvent(
  pool: Pool,
  eventId: bigint,
  organizerUserId: bigint,
  patch: Partial<{
    categoryId: number | null;
    title: string;
    description: string | null;
    venueName: string;
    venueCity: string | null;
    venueCountry: string | null;
    venueState: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    startsAt: Date;
    endsAt: Date;
    isB2b: boolean;
    isB2c: boolean;
    tags: string[] | null;
    requireBookingApproval: boolean;
    entryQrAllowReentry: boolean;
    status: "draft" | "published" | "cancelled";
  }>
): Promise<boolean> {
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (patch.categoryId !== undefined) {
    fields.push("category_id = ?");
    vals.push(patch.categoryId);
  }
  if (patch.title !== undefined) {
    fields.push("title = ?");
    vals.push(patch.title);
  }
  if (patch.description !== undefined) {
    fields.push("description = ?");
    vals.push(patch.description);
  }
  if (patch.venueName !== undefined) {
    fields.push("venue_name = ?");
    vals.push(patch.venueName);
  }
  if (patch.venueCity !== undefined) {
    fields.push("venue_city = ?");
    vals.push(patch.venueCity);
  }
  if (patch.venueCountry !== undefined) {
    fields.push("venue_country = ?");
    vals.push(patch.venueCountry);
  }
  if (patch.venueState !== undefined) {
    fields.push("venue_state = ?");
    vals.push(patch.venueState);
  }
  if (patch.address !== undefined) {
    fields.push("address = ?");
    vals.push(patch.address);
  }
  if (patch.latitude !== undefined) {
    fields.push("latitude = ?");
    vals.push(patch.latitude);
  }
  if (patch.longitude !== undefined) {
    fields.push("longitude = ?");
    vals.push(patch.longitude);
  }
  if (patch.startsAt !== undefined) {
    fields.push("starts_at = ?");
    vals.push(patch.startsAt);
  }
  if (patch.endsAt !== undefined) {
    fields.push("ends_at = ?");
    vals.push(patch.endsAt);
  }
  if (patch.isB2b !== undefined) {
    fields.push("is_b2b = ?");
    vals.push(patch.isB2b ? 1 : 0);
  }
  if (patch.isB2c !== undefined) {
    fields.push("is_b2c = ?");
    vals.push(patch.isB2c ? 1 : 0);
  }
  if (patch.tags !== undefined) {
    fields.push("tags = ?");
    vals.push(patch.tags ? JSON.stringify(patch.tags) : null);
  }
  if (patch.requireBookingApproval !== undefined) {
    fields.push("require_booking_approval = ?");
    vals.push(patch.requireBookingApproval ? 1 : 0);
  }
  if (patch.entryQrAllowReentry !== undefined) {
    fields.push("entry_qr_allow_reentry = ?");
    vals.push(patch.entryQrAllowReentry ? 1 : 0);
  }
  if (patch.status !== undefined) {
    fields.push("status = ?");
    vals.push(patch.status);
    if (patch.status === "published") {
      fields.push("published_at = COALESCE(published_at, NOW())");
    }
  }
  if (!fields.length) return true;
  vals.push(eventId, organizerUserId);
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE events SET ${fields.join(", ")} WHERE id = ? AND organizer_user_id = ?`,
    vals
  );
  return res.affectedRows > 0;
}

export async function findEventById(pool: Pool, id: bigint): Promise<EventRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM events WHERE id = ? LIMIT 1",
    [id]
  );
  if (!rows.length) return null;
  return mapEvent(rows[0]);
}

export type PublishedEventsListOpts = {
  search?: string;
  categoryId?: number;
  b2bOnly?: boolean;
  b2cOnly?: boolean;
  /** Partial match, case-insensitive */
  venueCity?: string;
  /** Partial match, case-insensitive */
  venueState?: string;
  /** Inclusive calendar day (YYYY-MM-DD): events that end on or after this day start */
  dateFrom?: string;
  /** Inclusive calendar day (YYYY-MM-DD): events that start on or before this day end */
  dateTo?: string;
  /** Only rows favorited by this user */
  favoritesUserId?: bigint;
};

function buildPublishedEventsFilters(opts: PublishedEventsListOpts = {}) {
  const clauses: string[] = ["events.status = 'published'", "events.ends_at >= NOW()"];
  const params: unknown[] = [];
  const search = opts.search?.trim();
  if (search) {
    clauses.push("(events.title LIKE ? OR events.description LIKE ?)");
    const q = `%${search}%`;
    params.push(q, q);
  }
  if (opts.categoryId != null && opts.categoryId > 0) {
    clauses.push(
      "(events.category_id = ? OR EXISTS (SELECT 1 FROM event_category_links ecl WHERE ecl.event_id = events.id AND ecl.category_id = ?))"
    );
    params.push(opts.categoryId, opts.categoryId);
  }
  if (opts.b2bOnly) {
    clauses.push("events.is_b2b = 1");
  }
  if (opts.b2cOnly) {
    clauses.push("events.is_b2c = 1");
  }
  const city = opts.venueCity?.trim();
  if (city) {
    clauses.push("events.venue_city IS NOT NULL AND LOWER(events.venue_city) LIKE LOWER(?)");
    params.push(`%${city}%`);
  }
  const st = opts.venueState?.trim();
  if (st) {
    clauses.push("events.venue_state IS NOT NULL AND LOWER(events.venue_state) LIKE LOWER(?)");
    params.push(`%${st}%`);
  }
  const df = opts.dateFrom?.trim();
  if (df && /^\d{4}-\d{2}-\d{2}$/.test(df)) {
    clauses.push("events.ends_at >= ?");
    params.push(`${df} 00:00:00`);
  }
  const dt = opts.dateTo?.trim();
  if (dt && /^\d{4}-\d{2}-\d{2}$/.test(dt)) {
    clauses.push("events.starts_at <= ?");
    params.push(`${dt} 23:59:59`);
  }
  if (opts.favoritesUserId != null) {
    clauses.push(
      "EXISTS (SELECT 1 FROM exhibitor_event_favorites f WHERE f.event_id = events.id AND f.user_id = ?)"
    );
    params.push(opts.favoritesUserId);
  }
  return { clauses, params };
}

export async function listPublishedEvents(pool: Pool, opts?: PublishedEventsListOpts): Promise<EventRow[]> {
  const { clauses, params } = buildPublishedEventsFilters(opts);
  const sql = `SELECT events.* FROM events WHERE ${clauses.join(" AND ")} ORDER BY events.starts_at ASC`;
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return rows.map((r) => mapEvent(r));
}

/** Same filters as {@link listPublishedEvents}, plus first gallery/banner image per event. */
export async function listPublishedEventsWithCover(
  pool: Pool,
  opts?: PublishedEventsListOpts
): Promise<{ event: EventRow; coverImageUrl: string | null }[]> {
  const { clauses, params } = buildPublishedEventsFilters(opts);
  const sql = `SELECT events.*,
    (SELECT em.url FROM event_media em
     WHERE em.event_id = events.id AND em.media_type IN ('image', 'other')
     ORDER BY em.sort_order ASC, em.id ASC LIMIT 1) AS cover_image_url
    FROM events WHERE ${clauses.join(" AND ")} ORDER BY events.starts_at ASC`;
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return rows.map((r) => {
    const cover = r.cover_image_url != null && String(r.cover_image_url).trim() !== "" ? String(r.cover_image_url) : null;
    const { cover_image_url: _drop, ...rest } = r as RowDataPacket & { cover_image_url?: string | null };
    return { event: mapEvent(rest), coverImageUrl: cover };
  });
}

const SEED_EVENT_CATEGORIES_SQL = `INSERT IGNORE INTO event_categories (name, slug, sort_order) VALUES
  ('Trade & Commerce', 'trade-commerce', 1),
  ('Technology', 'technology', 2),
  ('Lifestyle', 'lifestyle', 3),
  ('Agriculture', 'agriculture', 4)`;

export async function listEventCategories(pool: Pool) {
  await pool.query(SEED_EVENT_CATEGORIES_SQL);
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, name, slug, sort_order FROM event_categories ORDER BY sort_order ASC, id ASC"
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    slug: String(r.slug),
    sortOrder: Number(r.sort_order),
  }));
}

export async function listEventsForOrganizer(pool: Pool, organizerUserId: bigint): Promise<EventRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM events WHERE organizer_user_id = ? ORDER BY starts_at DESC",
    [organizerUserId]
  );
  return rows.map((r) => mapEvent(r));
}

/** First image URL per event (banner / gallery order: sort_order, id). */
export async function listEventsForOrganizerWithCover(
  pool: Pool,
  organizerUserId: bigint
): Promise<{ event: EventRow; coverImageUrl: string | null }[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT e.*,
       (SELECT em.url FROM event_media em
        WHERE em.event_id = e.id AND em.media_type IN ('image', 'other')
        ORDER BY em.sort_order ASC, em.id ASC LIMIT 1) AS cover_image_url
     FROM events e
     WHERE e.organizer_user_id = ?
     ORDER BY e.starts_at DESC`,
    [organizerUserId]
  );
  return rows.map((r) => {
    const cover = r.cover_image_url != null && String(r.cover_image_url).trim() !== "" ? String(r.cover_image_url) : null;
    const { cover_image_url: _drop, ...rest } = r as RowDataPacket & { cover_image_url?: string | null };
    return { event: mapEvent(rest), coverImageUrl: cover };
  });
}

export async function deleteEventAsOrganizer(
  pool: Pool,
  eventId: bigint,
  organizerUserId: bigint
): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>(
    "DELETE FROM events WHERE id = ? AND organizer_user_id = ?",
    [eventId, organizerUserId]
  );
  return res.affectedRows > 0;
}

export async function insertEventReview(
  pool: Pool,
  input: {
    eventId: bigint;
    reviewerUserId: bigint;
    rating: number;
    comment: string | null;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO event_reviews (event_id, reviewer_user_id, rating, comment)
     VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE rating=VALUES(rating), comment=VALUES(comment)`,
    [input.eventId, input.reviewerUserId, input.rating, input.comment]
  );
  return BigInt(r.insertId);
}

export async function listReviewsForEvent(pool: Pool, eventId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id, r.rating, r.comment, r.created_at, u.full_name AS reviewer_name
     FROM event_reviews r
     INNER JOIN users u ON u.id = r.reviewer_user_id
     WHERE r.event_id = ?
     ORDER BY r.created_at DESC`,
    [eventId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    rating: Number(r.rating),
    comment: r.comment != null ? String(r.comment) : null,
    reviewerName: String(r.reviewer_name),
    createdAt: r.created_at,
  }));
}
