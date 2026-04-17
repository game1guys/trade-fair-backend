import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type Audience = "all" | "organizers" | "exhibitors" | "visitors";
export type Channel = "inapp" | "email" | "whatsapp";

export async function upsertTemplate(
  pool: Pool,
  input: {
    id?: bigint | null;
    code: string;
    title: string;
    body: string;
    audience: Audience;
  }
): Promise<bigint> {
  if (input.id) {
    await pool.query(
      `UPDATE notification_templates
       SET code = ?, title = ?, body = ?, audience = ?
       WHERE id = ?`,
      [input.code, input.title, input.body, input.audience, input.id]
    );
    return input.id;
  }
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO notification_templates (code, title, body, audience)
     VALUES (?,?,?,?)`,
    [input.code, input.title, input.body, input.audience]
  );
  return BigInt(r.insertId);
}

export async function listTemplates(pool: Pool) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, code, title, body, audience, created_at
     FROM notification_templates
     ORDER BY id DESC
     LIMIT 200`
  );
  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    title: String(r.title),
    body: String(r.body),
    audience: String(r.audience),
    createdAt: r.created_at,
  }));
}

export async function createInAppNotificationsForAudience(
  pool: Pool,
  input: {
    templateId: bigint | null;
    audience: Audience;
    payload: Record<string, unknown> | null;
  }
): Promise<{ inserted: number }> {
  // Resolve user IDs for the audience.
  // Note: visitors can exist without VISITOR role due to onboarding, but this is good-enough for Phase 2.
  const roleCode =
    input.audience === "organizers"
      ? "ORGANIZER"
      : input.audience === "exhibitors"
        ? "EXHIBITOR"
        : input.audience === "visitors"
          ? "VISITOR"
          : null;

  if (!roleCode) {
    const [r] = await pool.query<ResultSetHeader>(
      `INSERT INTO notifications (template_id, to_user_id, channel, payload_json, status)
       SELECT ?, u.id, 'inapp', ?, 'queued'
       FROM users u`,
      [input.templateId, input.payload ? JSON.stringify(input.payload) : null]
    );
    return { inserted: Number(r.affectedRows ?? 0) };
  }

  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO notifications (template_id, to_user_id, channel, payload_json, status)
     SELECT ?, ur.user_id, 'inapp', ?, 'queued'
     FROM user_roles ur
     INNER JOIN roles r ON r.id = ur.role_id AND r.code = ?`,
    [input.templateId, input.payload ? JSON.stringify(input.payload) : null, roleCode]
  );
  return { inserted: Number(r.affectedRows ?? 0) };
}

export async function listMyNotifications(pool: Pool, userId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT n.id, n.channel, n.status, n.payload_json, n.created_at,
            t.code AS template_code, t.title AS template_title, t.body AS template_body
     FROM notifications n
     LEFT JOIN notification_templates t ON t.id = n.template_id
     WHERE n.to_user_id = ?
     ORDER BY n.id DESC
     LIMIT 200`,
    [userId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    channel: String(r.channel),
    status: String(r.status),
    createdAt: r.created_at,
    template: r.template_code
      ? { code: String(r.template_code), title: String(r.template_title), body: String(r.template_body) }
      : null,
    payload: r.payload_json != null ? (r.payload_json as unknown) : null,
  }));
}

export async function adminListNotifications(pool: Pool, limit: number) {
  const lim = Math.max(1, Math.min(500, limit));
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT n.id, n.channel, n.status, n.created_at, n.to_user_id,
            u.email AS to_email,
            t.code AS template_code, t.title AS template_title
     FROM notifications n
     LEFT JOIN users u ON u.id = n.to_user_id
     LEFT JOIN notification_templates t ON t.id = n.template_id
     ORDER BY n.id DESC
     LIMIT ?`,
    [lim]
  );
  return rows.map((r) => ({
    id: String(r.id),
    toUserId: r.to_user_id != null ? String(r.to_user_id) : null,
    toEmail: r.to_email != null ? String(r.to_email) : null,
    channel: String(r.channel),
    status: String(r.status),
    createdAt: r.created_at,
    templateCode: r.template_code != null ? String(r.template_code) : null,
    templateTitle: r.template_title != null ? String(r.template_title) : null,
  }));
}

