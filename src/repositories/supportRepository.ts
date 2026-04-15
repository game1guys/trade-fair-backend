import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function createSupportTicket(
  pool: Pool,
  input: {
    createdByUserId: bigint;
    roleCode: string;
    subject: string;
    body: string;
    priority: "low" | "normal" | "high";
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO support_tickets (created_by_user_id, role_code, subject, body, priority)
     VALUES (?,?,?,?,?)`,
    [input.createdByUserId, input.roleCode, input.subject, input.body, input.priority]
  );
  return BigInt(r.insertId);
}

export async function listMySupportTickets(pool: Pool, userId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, subject, status, priority, assigned_to_user_id, created_at, updated_at
     FROM support_tickets
     WHERE created_by_user_id = ?
     ORDER BY id DESC
     LIMIT 200`,
    [userId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    subject: String(r.subject),
    status: String(r.status),
    priority: String(r.priority),
    assignedToUserId: r.assigned_to_user_id != null ? String(r.assigned_to_user_id) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function adminListSupportTickets(pool: Pool) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT t.id, t.subject, t.body, t.status, t.priority, t.created_at, t.updated_at,
            t.created_by_user_id, u.email AS creator_email,
            t.assigned_to_user_id, a.email AS assignee_email
     FROM support_tickets t
     INNER JOIN users u ON u.id = t.created_by_user_id
     LEFT JOIN users a ON a.id = t.assigned_to_user_id
     ORDER BY t.id DESC
     LIMIT 200`
  );
  return rows.map((r) => ({
    id: String(r.id),
    subject: String(r.subject),
    body: String(r.body),
    status: String(r.status),
    priority: String(r.priority),
    creatorUserId: String(r.created_by_user_id),
    creatorEmail: String(r.creator_email),
    assignedToUserId: r.assigned_to_user_id != null ? String(r.assigned_to_user_id) : null,
    assigneeEmail: r.assignee_email != null ? String(r.assignee_email) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function adminPatchSupportTicket(
  pool: Pool,
  ticketId: bigint,
  patch: { status?: string; priority?: string; assignedToUserId?: bigint | null }
): Promise<boolean> {
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (patch.status !== undefined) {
    fields.push("status = ?");
    vals.push(patch.status);
  }
  if (patch.priority !== undefined) {
    fields.push("priority = ?");
    vals.push(patch.priority);
  }
  if (patch.assignedToUserId !== undefined) {
    fields.push("assigned_to_user_id = ?");
    vals.push(patch.assignedToUserId);
  }
  if (!fields.length) return true;
  vals.push(ticketId);
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE support_tickets SET ${fields.join(", ")} WHERE id = ?`,
    vals
  );
  return r.affectedRows > 0;
}

