import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function insertCommunicationLog(
  pool: Pool,
  input: {
    eventId: bigint;
    createdByUserId: bigint;
    channel: "email" | "whatsapp" | "in_app";
    audience: "exhibitors" | "visitors" | "both";
    subject: string | null;
    body: string;
    recipientCount: number;
    meta: Record<string, unknown> | null;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO organizer_communication_log
     (event_id, channel, audience, subject, body, recipient_count, meta, created_by_user_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      input.eventId,
      input.channel,
      input.audience,
      input.subject,
      input.body,
      input.recipientCount,
      input.meta != null ? JSON.stringify(input.meta) : null,
      input.createdByUserId,
    ]
  );
  return BigInt(r.insertId);
}

export async function listCommunicationLogs(pool: Pool, eventId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, channel, audience, subject, body, recipient_count, meta, created_at
     FROM organizer_communication_log WHERE event_id = ? ORDER BY created_at DESC LIMIT 100`,
    [eventId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    channel: r.channel,
    audience: r.audience,
    subject: r.subject != null ? String(r.subject) : null,
    body: String(r.body),
    recipientCount: Number(r.recipient_count ?? 0),
    meta: r.meta != null ? (typeof r.meta === "string" ? JSON.parse(r.meta as string) : r.meta) : null,
    createdAt: r.created_at,
  }));
}
