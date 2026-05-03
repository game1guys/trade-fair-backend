import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

function isMissingFavoritesTable(err: unknown): boolean {
  const e = err as { code?: string; errno?: number };
  return e?.code === "ER_NO_SUCH_TABLE" || e?.errno === 1146;
}

export async function listFavoriteEventIdsForUser(pool: Pool, userId: bigint): Promise<bigint[]> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT event_id FROM exhibitor_event_favorites WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );
    return rows.map((r) => BigInt(String(r.event_id)));
  } catch (err) {
    if (isMissingFavoritesTable(err)) return [];
    throw err;
  }
}

export async function addFavorite(pool: Pool, userId: bigint, eventId: bigint): Promise<void> {
  try {
    await pool.query<ResultSetHeader>(
      "INSERT INTO exhibitor_event_favorites (user_id, event_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id",
      [userId, eventId]
    );
  } catch (err) {
    if (isMissingFavoritesTable(err)) {
      throw Object.assign(
        new Error(
          "exhibitor_event_favorites table missing — apply trade-fair-backend/db/017_app_self_heal_after_migrations.sql or restart the API."
        ),
        { code: "FAVORITES_TABLE_MISSING" as const }
      );
    }
    throw err;
  }
}

export async function removeFavorite(pool: Pool, userId: bigint, eventId: bigint): Promise<boolean> {
  try {
    const [r] = await pool.query<ResultSetHeader>(
      "DELETE FROM exhibitor_event_favorites WHERE user_id = ? AND event_id = ?",
      [userId, eventId]
    );
    return r.affectedRows > 0;
  } catch (err) {
    if (isMissingFavoritesTable(err)) return false;
    throw err;
  }
}
