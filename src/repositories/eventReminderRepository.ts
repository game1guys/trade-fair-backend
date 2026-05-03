import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type ReminderAudience = "exhibitors" | "visitors" | "both";
export type ReminderChannel = "email" | "whatsapp" | "both";
export type ReminderStatus = "scheduled" | "sent" | "cancelled";

export async function listRemindersForEvent(pool: Pool, eventId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, remind_at, channel, title, body, audience, status, created_at
     FROM event_reminders WHERE event_id = ? ORDER BY remind_at ASC`,
    [eventId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    remindAt: r.remind_at,
    channel: r.channel as ReminderChannel,
    title: String(r.title ?? ""),
    body: String(r.body),
    audience: r.audience as ReminderAudience,
    status: r.status as ReminderStatus,
    createdAt: r.created_at,
  }));
}

export async function insertReminder(
  pool: Pool,
  input: {
    eventId: bigint;
    remindAt: Date;
    channel: ReminderChannel;
    title: string;
    body: string;
    audience: ReminderAudience;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO event_reminders (event_id, remind_at, channel, title, body, audience, status)
     VALUES (?,?,?,?,?,?, 'scheduled')`,
    [input.eventId, input.remindAt, input.channel, input.title, input.body, input.audience]
  );
  return BigInt(r.insertId);
}

export async function updateReminder(
  pool: Pool,
  eventId: bigint,
  reminderId: bigint,
  patch: {
    remindAt?: Date;
    channel?: ReminderChannel;
    title?: string;
    body?: string;
    audience?: ReminderAudience;
    status?: ReminderStatus;
  }
): Promise<boolean> {
  const parts: string[] = [];
  const vals: unknown[] = [];
  if (patch.remindAt !== undefined) {
    parts.push("remind_at = ?");
    vals.push(patch.remindAt);
  }
  if (patch.channel !== undefined) {
    parts.push("channel = ?");
    vals.push(patch.channel);
  }
  if (patch.title !== undefined) {
    parts.push("title = ?");
    vals.push(patch.title);
  }
  if (patch.body !== undefined) {
    parts.push("body = ?");
    vals.push(patch.body);
  }
  if (patch.audience !== undefined) {
    parts.push("audience = ?");
    vals.push(patch.audience);
  }
  if (patch.status !== undefined) {
    parts.push("status = ?");
    vals.push(patch.status);
  }
  if (!parts.length) return true;
  vals.push(reminderId, eventId);
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE event_reminders SET ${parts.join(", ")} WHERE id = ? AND event_id = ?`,
    vals
  );
  return r.affectedRows > 0;
}

export async function deleteReminder(pool: Pool, eventId: bigint, reminderId: bigint): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "DELETE FROM event_reminders WHERE id = ? AND event_id = ?",
    [reminderId, eventId]
  );
  return r.affectedRows > 0;
}

export async function listDueScheduledReminders(pool: Pool, limit = 25) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, event_id, remind_at, channel, title, body, audience
     FROM event_reminders
     WHERE status = 'scheduled' AND remind_at <= UTC_TIMESTAMP()
     ORDER BY remind_at ASC
     LIMIT ?`,
    [limit]
  );
  return rows.map((r) => ({
    id: BigInt(r.id as string),
    eventId: BigInt(r.event_id as string),
    remindAt: r.remind_at as Date,
    channel: r.channel as ReminderChannel,
    title: String(r.title ?? ""),
    body: String(r.body),
    audience: r.audience as ReminderAudience,
  }));
}

export async function setReminderStatus(pool: Pool, reminderId: bigint, status: ReminderStatus): Promise<void> {
  await pool.query<ResultSetHeader>("UPDATE event_reminders SET status = ? WHERE id = ?", [status, reminderId]);
}
