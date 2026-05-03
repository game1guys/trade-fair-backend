import type { Pool, RowDataPacket } from "mysql2/promise";

export async function listBookingsForEvent(pool: Pool, eventId: bigint) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT b.id AS booking_id, b.exhibitor_user_id, b.status, b.subtotal_minor, b.currency, b.created_at,
            u.email AS exhibitor_email, u.full_name AS exhibitor_name,
            bi.id AS item_id, bi.stall_id, bi.unit_price_minor, s.label AS stall_label
     FROM bookings b
     INNER JOIN users u ON u.id = b.exhibitor_user_id
     LEFT JOIN booking_items bi ON bi.booking_id = b.id
     LEFT JOIN stalls s ON s.id = bi.stall_id
     WHERE b.event_id = ?
     ORDER BY b.created_at DESC, bi.id ASC`,
    [eventId]
  );

  const map = new Map<
    string,
    {
      id: string;
      exhibitorUserId: string;
      exhibitorEmail: string;
      exhibitorName: string | null;
      status: string;
      subtotalMinor: string;
      currency: string;
      createdAt: Date;
      items: { itemId: string; stallId: string; label: string | null; unitPriceMinor: string }[];
    }
  >();

  for (const r of rows) {
    const bid = String(r.booking_id);
    let row = map.get(bid);
    if (!row) {
      row = {
        id: bid,
        exhibitorUserId: String(r.exhibitor_user_id),
        exhibitorEmail: String(r.exhibitor_email),
        exhibitorName: r.exhibitor_name != null ? String(r.exhibitor_name) : null,
        status: String(r.status),
        subtotalMinor: String(r.subtotal_minor),
        currency: String(r.currency),
        createdAt: r.created_at as Date,
        items: [],
      };
      map.set(bid, row);
    }
    if (r.stall_id != null && r.item_id != null) {
      row.items.push({
        itemId: String(r.item_id),
        stallId: String(r.stall_id),
        label: r.stall_label != null ? String(r.stall_label) : null,
        unitPriceMinor: String(r.unit_price_minor),
      });
    }
  }

  return [...map.values()];
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

/** Approximate unique recipient count for bulk messaging (exhibitors + visitors may overlap). */
export async function countAudienceRecipients(
  pool: Pool,
  eventId: bigint,
  audience: "exhibitors" | "visitors" | "both"
): Promise<number> {
  if (audience === "exhibitors") {
    const [[r]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(DISTINCT exhibitor_user_id) AS c FROM bookings WHERE event_id = ?",
      [eventId]
    );
    return Number(r?.c ?? 0);
  }
  if (audience === "visitors") {
    const [[r]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(DISTINCT visitor_user_id) AS c FROM tickets WHERE event_id = ?",
      [eventId]
    );
    return Number(r?.c ?? 0);
  }
  const [[e]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(DISTINCT exhibitor_user_id) AS c FROM bookings WHERE event_id = ?",
    [eventId]
  );
  const [[v]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(DISTINCT visitor_user_id) AS c FROM tickets WHERE event_id = ?",
    [eventId]
  );
  return Number(e?.c ?? 0) + Number(v?.c ?? 0);
}

export async function getEventReportsSummary(pool: Pool, eventId: bigint) {
  const [[stallRev]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(subtotal_minor), 0) AS minor FROM bookings WHERE event_id = ? AND status = 'confirmed'`,
    [eventId]
  );
  const [[ticketRev]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(total_minor), 0) AS minor FROM ticket_orders WHERE event_id = ? AND status = 'paid'`,
    [eventId]
  );
  const [[ticketCounts]] = await pool.query<RowDataPacket[]>(
    `SELECT 
       COUNT(*) AS tickets_total,
       SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS tickets_used
     FROM tickets WHERE event_id = ?`,
    [eventId]
  );
  const [[bookingCounts]] = await pool.query<RowDataPacket[]>(
    `SELECT 
       COUNT(*) AS bookings_total,
       SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS bookings_confirmed,
       SUM(CASE WHEN status IN ('pending','pending_approval') THEN 1 ELSE 0 END) AS bookings_pending
     FROM bookings WHERE event_id = ?`,
    [eventId]
  );
  return {
    stallRevenueMinor: String(stallRev.minor ?? 0),
    ticketRevenueMinor: String(ticketRev.minor ?? 0),
    ticketsSoldTotal: Number(ticketCounts?.tickets_total ?? 0),
    ticketsCheckedIn: Number(ticketCounts?.tickets_used ?? 0),
    stallBookingsTotal: Number(bookingCounts?.bookings_total ?? 0),
    stallBookingsConfirmed: Number(bookingCounts?.bookings_confirmed ?? 0),
    /** Pending payment + pending organizer approval (aggregated; see booking list for detail). */
    stallBookingsPending: Number(bookingCounts?.bookings_pending ?? 0),
  };
}

/** Distinct emails for reminder / bulk delivery (exhibitors who have any booking on the event). */
export async function listExhibitorEmailsForEvent(pool: Pool, eventId: bigint): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT u.email AS email
     FROM bookings b
     INNER JOIN users u ON u.id = b.exhibitor_user_id
     WHERE b.event_id = ?`,
    [eventId]
  );
  return rows.map((r) => String(r.email)).filter(Boolean);
}

export async function listVisitorEmailsForEvent(pool: Pool, eventId: bigint): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT u.email AS email
     FROM tickets t
     INNER JOIN users u ON u.id = t.visitor_user_id
     WHERE t.event_id = ?`,
    [eventId]
  );
  return rows.map((r) => String(r.email)).filter(Boolean);
}

/** E.164-ish digits only, for WhatsApp Cloud API. */
export async function listExhibitorPhonesForEvent(pool: Pool, eventId: bigint): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT u.phone AS phone
     FROM bookings b
     INNER JOIN users u ON u.id = b.exhibitor_user_id
     WHERE b.event_id = ? AND u.phone IS NOT NULL AND TRIM(u.phone) <> ''`,
    [eventId]
  );
  return [...new Set(rows.map((r) => String(r.phone).replace(/\D/g, "")).filter((p) => p.length >= 10))];
}

export async function listVisitorPhonesForEvent(pool: Pool, eventId: bigint): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT u.phone AS phone
     FROM tickets t
     INNER JOIN users u ON u.id = t.visitor_user_id
     WHERE t.event_id = ? AND u.phone IS NOT NULL AND TRIM(u.phone) <> ''`,
    [eventId]
  );
  return [...new Set(rows.map((r) => String(r.phone).replace(/\D/g, "")).filter((p) => p.length >= 10))];
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

/** CSV for organizer: stall bookings + visitor tickets for one event. */
export async function buildEventReportsCsv(pool: Pool, eventId: bigint): Promise<string> {
  const esc = (s: string | null | undefined) => {
    const x = s == null ? "" : String(s);
    return `"${x.replace(/"/g, '""')}"`;
  };
  const [bRows] = await pool.query<RowDataPacket[]>(
    `SELECT b.id, b.status, b.subtotal_minor, b.currency, b.created_at,
            u.email AS exhibitor_email, u.full_name AS exhibitor_name
     FROM bookings b
     INNER JOIN users u ON u.id = b.exhibitor_user_id
     WHERE b.event_id = ?
     ORDER BY b.id DESC`,
    [eventId]
  );
  const [tRows] = await pool.query<RowDataPacket[]>(
    `SELECT t.id, t.status, tt.name AS ticket_type, t.created_at,
            u.email AS visitor_email, u.full_name AS visitor_name
     FROM tickets t
     INNER JOIN ticket_types tt ON tt.id = t.ticket_type_id
     INNER JOIN users u ON u.id = t.visitor_user_id
     WHERE t.event_id = ?
     ORDER BY t.id DESC`,
    [eventId]
  );
  const lines: string[] = [];
  lines.push("section,booking_id,status,subtotal_minor,currency,created_at,exhibitor_email,exhibitor_name,,,,");
  for (const r of bRows) {
    lines.push(
      [
        "stall_booking",
        String(r.id),
        String(r.status),
        String(r.subtotal_minor),
        String(r.currency),
        String(r.created_at),
        esc(r.exhibitor_email as string),
        esc(r.exhibitor_name as string | null),
        "",
        "",
        "",
        "",
      ].join(",")
    );
  }
  lines.push("");
  lines.push("section,ticket_id,status,ticket_type,created_at,visitor_email,visitor_name,,,,,");
  for (const r of tRows) {
    lines.push(
      [
        "visitor_ticket",
        String(r.id),
        String(r.status),
        esc(r.ticket_type as string),
        String(r.created_at),
        esc(r.visitor_email as string),
        esc(r.visitor_name as string | null),
        "",
        "",
        "",
        "",
        "",
      ].join(",")
    );
  }
  return lines.join("\n");
}
