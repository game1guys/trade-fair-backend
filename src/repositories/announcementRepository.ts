import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type Audience = "exhibitors" | "visitors" | "both";

export async function listAnnouncementsForEventPublic(
  pool: Pool,
  eventId: bigint,
  audience: "exhibitor" | "visitor"
): Promise<{ id: string; title: string; body: string; createdAt: Date }[]> {
  const audFilter =
    audience === "visitor" ? "a.audience IN ('visitors','both')" : "a.audience IN ('exhibitors','both')";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT a.id, a.title, a.body, a.created_at
     FROM event_announcements a
     WHERE a.event_id = ? AND (${audFilter})
     ORDER BY a.created_at DESC
     LIMIT 50`,
    [eventId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    body: String(r.body),
    createdAt: r.created_at,
  }));
}

export async function listAnnouncementsForOrganizer(pool: Pool, eventId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, audience, title, body, created_at FROM event_announcements WHERE event_id = ? ORDER BY created_at DESC`,
    [eventId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    audience: r.audience as Audience,
    title: String(r.title),
    body: String(r.body),
    createdAt: r.created_at,
  }));
}

export async function insertAnnouncement(
  pool: Pool,
  input: {
    eventId: bigint;
    createdByUserId: bigint;
    audience: Audience;
    title: string;
    body: string;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO event_announcements (event_id, created_by_user_id, audience, title, body) VALUES (?,?,?,?,?)`,
    [input.eventId, input.createdByUserId, input.audience, input.title, input.body]
  );
  return BigInt(r.insertId);
}
