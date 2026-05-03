import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

function supportSlaDeadlines(priority: "low" | "normal" | "high"): { first: Date; resolve: Date } {
  const now = Date.now();
  const firstHours = priority === "high" ? 4 : priority === "low" ? 48 : 24;
  const resolveDays = priority === "high" ? 2 : priority === "low" ? 10 : 7;
  return {
    first: new Date(now + firstHours * 3_600_000),
    resolve: new Date(now + resolveDays * 86_400_000),
  };
}

export async function createSupportTicket(
  pool: Pool,
  input: {
    createdByUserId: bigint;
    roleCode: string;
    category: "technical" | "billing" | "stall_booking" | "ticket_booking" | "general" | "dispute";
    subject: string;
    body: string;
    priority: "low" | "normal" | "high";
    disputeId?: bigint | null;
  }
): Promise<bigint> {
  const sla = supportSlaDeadlines(input.priority);
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO support_tickets (created_by_user_id, role_code, category, subject, body, priority, sla_first_reply_due_at, sla_resolution_due_at, dispute_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      input.createdByUserId,
      input.roleCode,
      input.category,
      input.subject,
      input.body,
      input.priority,
      sla.first,
      sla.resolve,
      input.disputeId ?? null,
    ]
  );
  return BigInt(r.insertId);
}

export async function listMySupportTickets(pool: Pool, userId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, category, subject, status, priority, assigned_to_user_id, created_at, updated_at
     FROM support_tickets
     WHERE created_by_user_id = ?
     ORDER BY id DESC
     LIMIT 200`,
    [userId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    category: String(r.category),
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
    `SELECT t.id, t.category, t.subject, t.body, t.status, t.priority, t.created_at, t.updated_at,
            t.created_by_user_id, u.email AS creator_email,
            t.assigned_to_user_id, a.email AS assignee_email,
            t.dispute_id,
            t.sla_first_reply_due_at, t.sla_resolution_due_at, t.first_staff_action_at,
            (CASE
              WHEN t.first_staff_action_at IS NULL
               AND t.sla_first_reply_due_at IS NOT NULL
               AND t.sla_first_reply_due_at < NOW() THEN 1
              ELSE 0
            END) AS sla_first_breached,
            (CASE
              WHEN t.status NOT IN ('resolved','closed')
               AND t.sla_resolution_due_at IS NOT NULL
               AND t.sla_resolution_due_at < NOW() THEN 1
              ELSE 0
            END) AS sla_resolve_breached
     FROM support_tickets t
     INNER JOIN users u ON u.id = t.created_by_user_id
     LEFT JOIN users a ON a.id = t.assigned_to_user_id
     ORDER BY t.id DESC
     LIMIT 200`
  );
  return rows.map((r) => ({
    id: String(r.id),
    category: String(r.category),
    subject: String(r.subject),
    body: String(r.body),
    status: String(r.status),
    priority: String(r.priority),
    creatorUserId: String(r.created_by_user_id),
    creatorEmail: String(r.creator_email),
    assignedToUserId: r.assigned_to_user_id != null ? String(r.assigned_to_user_id) : null,
    assigneeEmail: r.assignee_email != null ? String(r.assignee_email) : null,
    disputeId: r.dispute_id != null ? String(r.dispute_id) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    slaFirstReplyDueAt: r.sla_first_reply_due_at ?? null,
    slaResolutionDueAt: r.sla_resolution_due_at ?? null,
    firstStaffActionAt: r.first_staff_action_at ?? null,
    slaFirstBreached: Boolean(Number(r.sla_first_breached ?? 0)),
    slaResolveBreached: Boolean(Number(r.sla_resolve_breached ?? 0)),
  }));
}

export async function addTicketResponse(
  pool: Pool,
  input: {
    ticketId: bigint;
    userId: bigint;
    body: string;
    isStaffResponse: boolean;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO support_ticket_responses (ticket_id, user_id, body, is_staff_response)
     VALUES (?,?,?,?)`,
    [input.ticketId, input.userId, input.body, input.isStaffResponse ? 1 : 0]
  );
  
  if (input.isStaffResponse) {
    await pool.query(
      "UPDATE support_tickets SET first_staff_action_at = COALESCE(first_staff_action_at, NOW()), updated_at = NOW() WHERE id = ?",
      [input.ticketId]
    );
  } else {
    await pool.query("UPDATE support_tickets SET updated_at = NOW() WHERE id = ?", [input.ticketId]);
  }
  
  return BigInt(r.insertId);
}

export async function listTicketResponses(pool: Pool, ticketId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id, r.user_id, u.full_name, u.email, r.body, r.is_staff_response, r.created_at
     FROM support_ticket_responses r
     INNER JOIN users u ON u.id = r.user_id
     WHERE r.ticket_id = ?
     ORDER BY r.id ASC`,
    [ticketId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    fullName: String(r.full_name),
    email: String(r.email),
    body: String(r.body),
    isStaffResponse: Boolean(r.is_staff_response),
    createdAt: r.created_at,
  }));
}

export async function addAttachment(
  pool: Pool,
  input: {
    ticketId: bigint;
    responseId?: bigint | null;
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO support_attachments (ticket_id, response_id, file_url, file_name, file_size, mime_type)
     VALUES (?,?,?,?,?,?)`,
    [input.ticketId, input.responseId ?? null, input.fileUrl, input.fileName, input.fileSize, input.mimeType]
  );
  return BigInt(r.insertId);
}

export async function listTicketAttachments(pool: Pool, ticketId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, response_id, file_url, file_name, file_size, mime_type, created_at
     FROM support_attachments
     WHERE ticket_id = ?`,
    [ticketId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    responseId: r.response_id != null ? String(r.response_id) : null,
    fileUrl: String(r.file_url),
    fileName: String(r.file_name),
    fileSize: Number(r.file_size),
    mimeType: String(r.mime_type),
    createdAt: r.created_at,
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
  const staffTouch =
    (patch.status !== undefined && patch.status !== "open") ||
    (patch.assignedToUserId !== undefined && patch.assignedToUserId != null);
  if (staffTouch) {
    fields.push("first_staff_action_at = COALESCE(first_staff_action_at, NOW())");
  }
  if (!fields.length) return true;
  vals.push(ticketId);
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE support_tickets SET ${fields.join(", ")} WHERE id = ?`,
    vals
  );
  return r.affectedRows > 0;
}

