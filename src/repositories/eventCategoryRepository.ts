import type { Pool, RowDataPacket } from "mysql2/promise";

export async function replaceEventCategoryLinks(pool: Pool, eventId: bigint, categoryIds: number[]): Promise<void> {
  await pool.query("DELETE FROM event_category_links WHERE event_id = ?", [eventId]);
  const uniq = [...new Set(categoryIds.filter((n) => Number.isFinite(n) && n > 0))];
  if (!uniq.length) return;
  const vals = uniq.flatMap((cid) => [eventId, cid]);
  const placeholders = uniq.map(() => "(?,?)").join(",");
  await pool.query(`INSERT INTO event_category_links (event_id, category_id) VALUES ${placeholders}`, vals);
}

export async function listCategoryIdsForEvent(pool: Pool, eventId: bigint): Promise<number[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT category_id FROM event_category_links WHERE event_id = ? ORDER BY category_id ASC",
    [eventId]
  );
  return rows.map((r) => Number(r.category_id));
}

export async function listCategoryIdsForEvents(pool: Pool, eventIds: bigint[]): Promise<Map<string, number[]>> {
  const m = new Map<string, number[]>();
  if (!eventIds.length) return m;
  const ph = eventIds.map(() => "?").join(",");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT event_id, category_id FROM event_category_links WHERE event_id IN (${ph}) ORDER BY event_id, category_id`,
    eventIds
  );
  for (const r of rows) {
    const eid = String(r.event_id);
    const arr = m.get(eid) ?? [];
    arr.push(Number(r.category_id));
    m.set(eid, arr);
  }
  return m;
}
