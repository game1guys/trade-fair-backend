import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function getSetting(pool: Pool, key: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `key`, value_json, updated_at, updated_by_user_id FROM system_settings WHERE `key` = ? LIMIT 1",
    [key]
  );
  if (!rows.length) return null;
  const r = rows[0];
  const v = typeof r.value_json === "string" ? JSON.parse(r.value_json) : r.value_json;
  return { key: String(r.key), value: v, updatedAt: r.updated_at, updatedByUserId: r.updated_by_user_id };
}

export async function upsertSetting(pool: Pool, key: string, value: unknown, userId: bigint) {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO system_settings (\`key\`, value_json, updated_by_user_id)
     VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_by_user_id = VALUES(updated_by_user_id)`,
    [key, JSON.stringify(value), userId]
  );
  return r.affectedRows > 0;
}

