import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function ensureOpenFlag(pool: Pool, input: { entityType: string; entityId: string }): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM content_flags WHERE entity_type = ? AND entity_id = ? AND status = 'open' LIMIT 1`,
    [input.entityType, input.entityId]
  );
  if (rows.length) return;
  await pool.query<ResultSetHeader>(
    `INSERT INTO content_flags (entity_type, entity_id, status) VALUES (?, ?, 'open')`,
    [input.entityType, input.entityId]
  );
}

