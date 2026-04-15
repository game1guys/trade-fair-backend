import type { Pool } from "mysql2/promise";

export async function insertAuditLog(
  pool: Pool,
  log: {
    actorUserId?: bigint | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
     VALUES (?, ?, ?, ?, ?)`,
    [
      log.actorUserId ?? null,
      log.action,
      log.entityType,
      log.entityId ?? null,
      log.metadata ? JSON.stringify(log.metadata) : null,
    ]
  );
}
