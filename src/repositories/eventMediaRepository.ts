import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function listMediaForEvent(pool: Pool, eventId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, url, media_type, sort_order FROM event_media WHERE event_id = ? ORDER BY sort_order ASC, id ASC",
    [eventId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    url: String(r.url),
    mediaType: r.media_type as string,
    sortOrder: Number(r.sort_order),
  }));
}

export async function insertEventMedia(
  pool: Pool,
  input: { eventId: bigint; url: string; mediaType: "image" | "video" | "other"; sortOrder: number }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO event_media (event_id, url, media_type, sort_order) VALUES (?,?,?,?)`,
    [input.eventId, input.url, input.mediaType, input.sortOrder]
  );
  return BigInt(r.insertId);
}

export async function deleteEventMedia(pool: Pool, mediaId: bigint, eventId: bigint): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "DELETE FROM event_media WHERE id = ? AND event_id = ?",
    [mediaId, eventId]
  );
  return r.affectedRows > 0;
}
