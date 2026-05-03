import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

/**
 * Adds columns that older DBs may lack if migrations were skipped.
 * Safe to run on every boot (checks information_schema first).
 */
export async function ensureOptionalSchema(pool: Pool): Promise<void> {
  const [dbRows] = await pool.query<RowDataPacket[]>("SELECT DATABASE() AS d");
  const db = String(dbRows[0]?.d ?? "").trim();
  if (!db) return;

  async function eventColumns(): Promise<Set<string>> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'events'`,
      [db]
    );
    return new Set(rows.map((r) => String(r.c)));
  }

  let cols = await eventColumns();
  if (!cols.has("venue_city")) {
    await pool.query("ALTER TABLE events ADD COLUMN venue_city VARCHAR(128) NULL AFTER venue_name");
    cols = await eventColumns();
    console.info("[db] Self-heal: added events.venue_city");
  }
  if (!cols.has("venue_country")) {
    const after = cols.has("venue_city") ? "venue_city" : "venue_name";
    await pool.query(
      `ALTER TABLE events ADD COLUMN venue_country VARCHAR(128) NULL AFTER \`${after}\``
    );
    console.info("[db] Self-heal: added events.venue_country");
  }
  cols = await eventColumns();
  if (!cols.has("venue_state")) {
    const after = cols.has("venue_country") ? "venue_country" : "venue_name";
    await pool.query(
      `ALTER TABLE events ADD COLUMN venue_state VARCHAR(128) NULL AFTER \`${after}\``
    );
    console.info("[db] Self-heal: added events.venue_state");
  }
  cols = await eventColumns();
  if (!cols.has("require_booking_approval")) {
    await pool.query(
      "ALTER TABLE events ADD COLUMN require_booking_approval TINYINT(1) NOT NULL DEFAULT 0 AFTER tags"
    );
    console.info("[db] Self-heal: added events.require_booking_approval");
  }

  async function tableColumns(table: string): Promise<Set<string>> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [db, table]
    );
    return new Set(rows.map((r) => String(r.c)));
  }

  let stCols = await tableColumns("support_tickets");
  if (!stCols.has("sla_first_reply_due_at")) {
    await pool.query(
      "ALTER TABLE support_tickets ADD COLUMN sla_first_reply_due_at DATETIME NULL AFTER assigned_to_user_id"
    );
    console.info("[db] Self-heal: added support_tickets.sla_first_reply_due_at");
    stCols = await tableColumns("support_tickets");
  }
  if (!stCols.has("sla_resolution_due_at")) {
    await pool.query(
      "ALTER TABLE support_tickets ADD COLUMN sla_resolution_due_at DATETIME NULL AFTER sla_first_reply_due_at"
    );
    console.info("[db] Self-heal: added support_tickets.sla_resolution_due_at");
    stCols = await tableColumns("support_tickets");
  }
  if (!stCols.has("first_staff_action_at")) {
    await pool.query(
      "ALTER TABLE support_tickets ADD COLUMN first_staff_action_at DATETIME NULL AFTER sla_resolution_due_at"
    );
    console.info("[db] Self-heal: added support_tickets.first_staff_action_at");
  }

  let uCols = await tableColumns("users");
  if (!uCols.has("pending_admin_review")) {
    await pool.query(
      "ALTER TABLE users ADD COLUMN pending_admin_review TINYINT(1) NOT NULL DEFAULT 0 AFTER status"
    );
    console.info("[db] Self-heal: added users.pending_admin_review");
  }

  const [favT] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS o FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'exhibitor_event_favorites' LIMIT 1`,
    [db]
  );
  if (!favT.length) {
    await pool.query(
      `CREATE TABLE exhibitor_event_favorites (
        user_id BIGINT UNSIGNED NOT NULL,
        event_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, event_id),
        INDEX idx_fav_user (user_id),
        INDEX idx_fav_event (event_id),
        CONSTRAINT fk_fav_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_fav_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    console.info("[db] Self-heal: created exhibitor_event_favorites");
  }

  let bookingCols = await tableColumns("bookings");
  if (!bookingCols.has("refund_requested_at")) {
    await pool.query("ALTER TABLE bookings ADD COLUMN refund_requested_at DATETIME NULL");
    console.info("[db] Self-heal: added bookings.refund_requested_at");
  }

  let usersCols = await tableColumns("users");
  if (!usersCols.has("phone_verified_at")) {
    await pool.query("ALTER TABLE users ADD COLUMN phone_verified_at DATETIME NULL AFTER phone");
    console.info("[db] Self-heal: added users.phone_verified_at");
  }
}
