import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function insertTicketType(
  pool: Pool,
  input: {
    eventId: bigint;
    name: string;
    priceMinor: bigint;
    quota: number;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO ticket_types (event_id, name, price_minor, quota) VALUES (?,?,?,?)`,
    [input.eventId, input.name, input.priceMinor, input.quota]
  );
  return BigInt(r.insertId);
}

export async function listTicketTypesForEvent(pool: Pool, eventId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM ticket_types WHERE event_id = ? ORDER BY id ASC",
    [eventId]
  );
  return rows.map((x) => ({
    id: BigInt(x.id as string),
    event_id: BigInt(x.event_id as string),
    name: x.name,
    price_minor: BigInt(x.price_minor as string),
    quota: Number(x.quota),
    sold_count: Number(x.sold_count),
  }));
}

export async function findTicketType(
  pool: Pool,
  id: bigint,
  eventId: bigint
): Promise<{
  id: bigint;
  price_minor: bigint;
  quota: number;
  sold_count: number;
} | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, price_minor, quota, sold_count FROM ticket_types WHERE id = ? AND event_id = ? LIMIT 1",
    [id, eventId]
  );
  if (!rows.length) return null;
  const x = rows[0];
  return {
    id: BigInt(x.id as string),
    price_minor: BigInt(x.price_minor as string),
    quota: Number(x.quota),
    sold_count: Number(x.sold_count),
  };
}

export async function incrementTicketSold(pool: Pool, ticketTypeId: bigint, delta: number): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE ticket_types SET sold_count = sold_count + ? WHERE id = ? AND sold_count + ? <= quota",
    [delta, ticketTypeId, delta]
  );
  return r.affectedRows > 0;
}

export async function insertTicketOrder(
  pool: Pool,
  input: {
    eventId: bigint;
    visitorUserId: bigint;
    ticketTypeId: bigint;
    quantity: number;
    totalMinor: bigint;
    currency: string;
    status: "pending" | "paid" | "failed" | "cancelled";
    razorpayOrderId: string | null;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO ticket_orders (event_id, visitor_user_id, ticket_type_id, quantity, status, currency, total_minor, razorpay_order_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      input.eventId,
      input.visitorUserId,
      input.ticketTypeId,
      input.quantity,
      input.status,
      input.currency,
      input.totalMinor,
      input.razorpayOrderId,
    ]
  );
  return BigInt(r.insertId);
}

export async function updateTicketOrder(
  pool: Pool,
  orderId: bigint,
  visitorUserId: bigint,
  patch: { status?: "pending" | "paid" | "failed" | "cancelled"; razorpayOrderId?: string | null }
): Promise<boolean> {
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (patch.status !== undefined) {
    fields.push("status = ?");
    vals.push(patch.status);
  }
  if (patch.razorpayOrderId !== undefined) {
    fields.push("razorpay_order_id = ?");
    vals.push(patch.razorpayOrderId);
  }
  if (!fields.length) return true;
  vals.push(orderId, visitorUserId);
  const [r] = await pool.query<ResultSetHeader>(
    `UPDATE ticket_orders SET ${fields.join(", ")} WHERE id = ? AND visitor_user_id = ?`,
    vals
  );
  return r.affectedRows > 0;
}

export async function findTicketOrderByRazorpayOrderId(
  pool: Pool,
  razorpayOrderId: string
): Promise<{
  id: bigint;
  event_id: bigint;
  visitor_user_id: bigint;
  status: string;
  total_minor: bigint;
  ticket_type_id: bigint | null;
  quantity: number;
} | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, event_id, visitor_user_id, status, total_minor, ticket_type_id, quantity FROM ticket_orders WHERE razorpay_order_id = ? LIMIT 1",
    [razorpayOrderId]
  );
  if (!rows.length) return null;
  const x = rows[0];
  return {
    id: BigInt(x.id as string),
    event_id: BigInt(x.event_id as string),
    visitor_user_id: BigInt(x.visitor_user_id as string),
    status: String(x.status),
    total_minor: BigInt(x.total_minor as string),
    ticket_type_id: x.ticket_type_id != null ? BigInt(x.ticket_type_id as string) : null,
    quantity: Number(x.quantity ?? 1),
  };
}

export async function findTicketOrder(
  pool: Pool,
  orderId: bigint,
  visitorUserId: bigint
): Promise<{
  id: bigint;
  event_id: bigint;
  status: string;
  total_minor: bigint;
  razorpay_order_id: string | null;
  ticket_type_id: bigint | null;
  quantity: number;
} | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, event_id, status, total_minor, razorpay_order_id, ticket_type_id, quantity FROM ticket_orders WHERE id = ? AND visitor_user_id = ? LIMIT 1",
    [orderId, visitorUserId]
  );
  if (!rows.length) return null;
  const x = rows[0];
  return {
    id: BigInt(x.id as string),
    event_id: BigInt(x.event_id as string),
    status: String(x.status),
    total_minor: BigInt(x.total_minor as string),
    razorpay_order_id: x.razorpay_order_id,
    ticket_type_id: x.ticket_type_id != null ? BigInt(x.ticket_type_id as string) : null,
    quantity: Number(x.quantity ?? 1),
  };
}

export async function insertTicket(
  pool: Pool,
  input: {
    ticketOrderId: bigint;
    ticketTypeId: bigint;
    visitorUserId: bigint;
    eventId: bigint;
  }
): Promise<bigint> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO tickets (ticket_order_id, ticket_type_id, visitor_user_id, event_id, status)
     VALUES (?,?,?,?, 'unused')`,
    [input.ticketOrderId, input.ticketTypeId, input.visitorUserId, input.eventId]
  );
  return BigInt(r.insertId);
}

export async function insertQrToken(
  pool: Pool,
  ticketId: bigint,
  secretHash: string,
  rawSecret: string
): Promise<void> {
  await pool.query(`INSERT INTO qr_tokens (ticket_id, secret_hash, raw_secret) VALUES (?,?,?)`, [
    ticketId,
    secretHash,
    rawSecret,
  ]);
}

export async function getQrRawSecretForTicket(
  pool: Pool,
  ticketId: bigint,
  visitorUserId: bigint
): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT q.raw_secret FROM qr_tokens q
     INNER JOIN tickets t ON t.id = q.ticket_id
     WHERE q.ticket_id = ? AND t.visitor_user_id = ? LIMIT 1`,
    [ticketId, visitorUserId]
  );
  if (!rows.length || rows[0].raw_secret == null) return null;
  return String(rows[0].raw_secret);
}

export async function findTicketByQrHash(
  pool: Pool,
  secretHash: string
): Promise<{
  ticket_id: bigint;
  event_id: bigint;
  status: string;
  visitor_user_id: bigint;
} | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT t.id AS ticket_id, t.event_id, t.status, t.visitor_user_id
     FROM qr_tokens q
     INNER JOIN tickets t ON t.id = q.ticket_id
     WHERE q.secret_hash = ? LIMIT 1`,
    [secretHash]
  );
  if (!rows.length) return null;
  const x = rows[0];
  return {
    ticket_id: BigInt(x.ticket_id as string),
    event_id: BigInt(x.event_id as string),
    status: String(x.status),
    visitor_user_id: BigInt(x.visitor_user_id as string),
  };
}

export async function markTicketUsed(pool: Pool, ticketId: bigint): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE tickets SET status = 'used', used_at = NOW() WHERE id = ? AND status = 'unused'",
    [ticketId]
  );
  return r.affectedRows > 0;
}

export async function insertEntryScan(
  pool: Pool,
  input: {
    ticketId: bigint;
    eventId: bigint;
    scannedByUserId: bigint;
    result: "valid" | "invalid" | "already_used" | "wrong_event";
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO entry_scans (ticket_id, event_id, scanned_by_user_id, result) VALUES (?,?,?,?)`,
    [input.ticketId, input.eventId, input.scannedByUserId, input.result]
  );
}

export async function listTicketsForVisitor(pool: Pool, visitorUserId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT t.id, t.event_id, t.status, t.created_at, e.title AS event_title
     FROM tickets t
     INNER JOIN events e ON e.id = t.event_id
     WHERE t.visitor_user_id = ?
     ORDER BY t.created_at DESC`,
    [visitorUserId]
  );
  return rows.map((x) => ({
    id: String(x.id),
    event_id: String(x.event_id),
    status: x.status,
    created_at: x.created_at,
    event_title: x.event_title,
  }));
}
