import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type EventRow = {
  id: bigint;
  organizer_user_id: bigint;
  category_id: number | null;
  title: string;
  description: string | null;
  venue_name: string;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  starts_at: Date;
  ends_at: Date;
  is_b2b: number;
  is_b2c: number;
  tags: unknown;
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
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    startsAt: Date;
    endsAt: Date;
    isB2b: boolean;
    isB2c: boolean;
    tags: string[] | null;
    status: "draft" | "published";
  }
): Promise<bigint> {
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO events (
      organizer_user_id, category_id, title, description, venue_name, address,
      latitude, longitude, starts_at, ends_at, is_b2b, is_b2c, tags, status, published_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.organizerUserId,
      input.categoryId,
      input.title,
      input.description,
      input.venueName,
      input.address,
      input.latitude,
      input.longitude,
      input.startsAt,
      input.endsAt,
      input.isB2b ? 1 : 0,
      input.isB2c ? 1 : 0,
      input.tags ? JSON.stringify(input.tags) : null,
      input.status,
      input.status === "published" ? new Date() : null,
    ]
  );
  return BigInt(result.insertId);
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
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    startsAt: Date;
    endsAt: Date;
    isB2b: boolean;
    isB2c: boolean;
    tags: string[] | null;
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

export async function listPublishedEvents(
  pool: Pool,
  opts?: {
    search?: string;
    categoryId?: number;
    b2bOnly?: boolean;
    b2cOnly?: boolean;
  }
): Promise<EventRow[]> {
  const clauses: string[] = ["status = 'published'", "ends_at >= NOW()"];
  const params: unknown[] = [];
  const search = opts?.search?.trim();
  if (search) {
    clauses.push("(title LIKE ? OR description LIKE ?)");
    const q = `%${search}%`;
    params.push(q, q);
  }
  if (opts?.categoryId != null && opts.categoryId > 0) {
    clauses.push("category_id = ?");
    params.push(opts.categoryId);
  }
  if (opts?.b2bOnly) {
    clauses.push("is_b2b = 1");
  }
  if (opts?.b2cOnly) {
    clauses.push("is_b2c = 1");
  }
  const sql = `SELECT * FROM events WHERE ${clauses.join(" AND ")} ORDER BY starts_at ASC`;
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return rows.map((r) => mapEvent(r));
}

export async function listEventCategories(pool: Pool) {
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
