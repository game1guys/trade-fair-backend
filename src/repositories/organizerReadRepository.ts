import type { Pool, RowDataPacket } from "mysql2/promise";

export async function listBookingsForEvent(pool: Pool, eventId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT b.id, b.exhibitor_user_id, b.status, b.subtotal_minor, b.currency, b.created_at,
            u.email AS exhibitor_email, u.full_name AS exhibitor_name
     FROM bookings b
     INNER JOIN users u ON u.id = b.exhibitor_user_id
     WHERE b.event_id = ?
     ORDER BY b.created_at DESC`,
    [eventId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    exhibitorUserId: String(r.exhibitor_user_id),
    exhibitorEmail: r.exhibitor_email,
    exhibitorName: r.exhibitor_name,
    status: r.status,
    subtotalMinor: String(r.subtotal_minor),
    currency: r.currency,
    createdAt: r.created_at,
  }));
}

export async function listTicketsForEvent(pool: Pool, eventId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT t.id, t.status, t.created_at, t.used_at,
            u.email AS visitor_email, u.full_name AS visitor_name,
            tt.name AS ticket_type_name
     FROM tickets t
     INNER JOIN users u ON u.id = t.visitor_user_id
     INNER JOIN ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.event_id = ?
     ORDER BY t.created_at DESC`,
    [eventId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    status: r.status,
    visitorEmail: r.visitor_email,
    visitorName: r.visitor_name,
    ticketTypeName: r.ticket_type_name,
    createdAt: r.created_at,
    usedAt: r.used_at,
  }));
}

export async function listEntryScansForEvent(pool: Pool, eventId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT es.id, es.result, es.scanned_at,
            t.id AS ticket_id,
            u.email AS scanner_email
     FROM entry_scans es
     INNER JOIN users u ON u.id = es.scanned_by_user_id
     LEFT JOIN tickets t ON t.id = es.ticket_id
     WHERE es.event_id = ?
     ORDER BY es.scanned_at DESC
     LIMIT 200`,
    [eventId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    ticketId: r.ticket_id != null ? String(r.ticket_id) : null,
    result: r.result,
    scannedAt: r.scanned_at,
    scannerEmail: r.scanner_email,
  }));
}
