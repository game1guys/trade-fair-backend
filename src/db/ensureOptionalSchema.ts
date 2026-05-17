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
  cols = await eventColumns();
  if (!cols.has("entry_qr_allow_reentry")) {
    const after = cols.has("require_booking_approval") ? "require_booking_approval" : "tags";
    await pool.query(
      `ALTER TABLE events ADD COLUMN entry_qr_allow_reentry TINYINT(1) NOT NULL DEFAULT 0 AFTER \`${after}\``
    );
    console.info("[db] Self-heal: added events.entry_qr_allow_reentry");
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

  let subPlanCols = await tableColumns("subscription_plans");
  if (!subPlanCols.has("target_role_code")) {
    await pool.query(
      "ALTER TABLE subscription_plans ADD COLUMN target_role_code VARCHAR(32) NOT NULL DEFAULT 'ORGANIZER' AFTER active"
    );
    console.info("[db] Self-heal: added subscription_plans.target_role_code");
  }
  subPlanCols = await tableColumns("subscription_plans");
  if (!subPlanCols.has("limitations_json")) {
    await pool.query("ALTER TABLE subscription_plans ADD COLUMN limitations_json JSON NULL AFTER target_role_code");
    console.info("[db] Self-heal: added subscription_plans.limitations_json");
  }
  subPlanCols = await tableColumns("subscription_plans");
  if (!subPlanCols.has("stall_booking_commission_bps")) {
    await pool.query(
      "ALTER TABLE subscription_plans ADD COLUMN stall_booking_commission_bps INT UNSIGNED NOT NULL DEFAULT 0 AFTER limitations_json"
    );
    console.info("[db] Self-heal: added subscription_plans.stall_booking_commission_bps");
  }

  let srCols = await tableColumns("service_requests");
  if (!srCols.has("context_event_id")) {
    await pool.query(
      `ALTER TABLE service_requests
       ADD COLUMN context_event_id BIGINT UNSIGNED NULL AFTER message,
       ADD INDEX idx_sr_context_event (context_event_id)`
    );
    await pool.query(
      `ALTER TABLE service_requests
       ADD CONSTRAINT fk_sr_context_event FOREIGN KEY (context_event_id) REFERENCES events (id) ON DELETE SET NULL`
    ).catch(() => {
      /* FK may fail on duplicate name — migration script defines constraint */
    });
    console.info("[db] Self-heal: added service_requests.context_event_id");
  }

  const [oppT] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS o FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'organizer_payout_profiles' LIMIT 1`,
    [db]
  );
  if (!oppT.length) {
    await pool.query(
      `CREATE TABLE organizer_payout_profiles (
        user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
        account_holder_name VARCHAR(255) NOT NULL,
        bank_account_number VARCHAR(32) NULL,
        ifsc VARCHAR(20) NULL,
        upi_id VARCHAR(255) NULL,
        razorpay_linked_account_id VARCHAR(64) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_opp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    console.info("[db] Self-heal: created organizer_payout_profiles");
  }

  const [svcT] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS o FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'services' LIMIT 1`,
    [db]
  );
  if (svcT.length) {
    let svcCols = await tableColumns("services");
    if (!svcCols.has("cover_image_url")) {
      await pool.query("ALTER TABLE services ADD COLUMN cover_image_url VARCHAR(512) NULL");
      console.info("[db] Self-heal: added services.cover_image_url");
      svcCols = await tableColumns("services");
    }
    if (!svcCols.has("image_urls")) {
      await pool.query("ALTER TABLE services ADD COLUMN image_urls JSON NULL");
      console.info("[db] Self-heal: added services.image_urls");
      svcCols = await tableColumns("services");
    }
    if (!svcCols.has("service_area")) {
      await pool.query("ALTER TABLE services ADD COLUMN service_area VARCHAR(255) NULL");
      console.info("[db] Self-heal: added services.service_area");
      svcCols = await tableColumns("services");
    }
    if (!svcCols.has("lead_time_days")) {
      await pool.query("ALTER TABLE services ADD COLUMN lead_time_days SMALLINT UNSIGNED NULL");
      console.info("[db] Self-heal: added services.lead_time_days");
      svcCols = await tableColumns("services");
    }
    if (!svcCols.has("delivery_notes")) {
      await pool.query("ALTER TABLE services ADD COLUMN delivery_notes TEXT NULL");
      console.info("[db] Self-heal: added services.delivery_notes");
    }
  }

  const [srmT] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS o FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'service_request_messages' LIMIT 1`,
    [db]
  );
  if (!srmT.length) {
    await pool.query(
      `CREATE TABLE service_request_messages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        service_request_id BIGINT UNSIGNED NOT NULL,
        from_user_id BIGINT UNSIGNED NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_srm_request (service_request_id),
        CONSTRAINT fk_srm_request FOREIGN KEY (service_request_id) REFERENCES service_requests (id) ON DELETE CASCADE,
        CONSTRAINT fk_srm_from FOREIGN KEY (from_user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    console.info("[db] Self-heal: created service_request_messages");
  }

  const [sppT] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS o FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'service_provider_profiles' LIMIT 1`,
    [db]
  );
  if (sppT.length) {
    let sppCols = await tableColumns("service_provider_profiles");
    if (!sppCols.has("years_in_business")) {
      await pool.query(
        "ALTER TABLE service_provider_profiles ADD COLUMN years_in_business SMALLINT UNSIGNED NULL AFTER booking_enabled"
      );
      console.info("[db] Self-heal: added service_provider_profiles.years_in_business");
      sppCols = await tableColumns("service_provider_profiles");
    }
  }

  const [oprT] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS o FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'organizer_provider_ratings' LIMIT 1`,
    [db]
  );
  if (!oprT.length) {
    await pool.query(
      `CREATE TABLE organizer_provider_ratings (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        organizer_user_id BIGINT UNSIGNED NOT NULL,
        provider_user_id BIGINT UNSIGNED NOT NULL,
        stars TINYINT UNSIGNED NOT NULL,
        comment TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_opr_org_provider (organizer_user_id, provider_user_id),
        INDEX idx_opr_provider (provider_user_id),
        CONSTRAINT fk_opr_org FOREIGN KEY (organizer_user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_opr_provider FOREIGN KEY (provider_user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    console.info("[db] Self-heal: created organizer_provider_ratings");
  }

  const [srcT] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS o FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'service_request_contracts' LIMIT 1`,
    [db]
  );
  if (!srcT.length) {
    await pool.query(
      `CREATE TABLE service_request_contracts (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        service_request_id BIGINT UNSIGNED NOT NULL,
        organizer_user_id BIGINT UNSIGNED NOT NULL,
        provider_user_id BIGINT UNSIGNED NOT NULL,
        status ENUM('pending_acceptance', 'accepted', 'declined', 'cancelled') NOT NULL DEFAULT 'pending_acceptance',
        service_description TEXT NOT NULL,
        duration_days INT UNSIGNED NOT NULL,
        people_count INT UNSIGNED NOT NULL,
        manpower_available INT UNSIGNED NULL,
        machinery_json JSON NULL,
        organizer_notes TEXT NULL,
        provider_notes TEXT NULL,
        sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        accepted_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_src_request (service_request_id),
        INDEX idx_src_provider (provider_user_id),
        INDEX idx_src_status (status),
        CONSTRAINT fk_src_request FOREIGN KEY (service_request_id) REFERENCES service_requests (id) ON DELETE CASCADE,
        CONSTRAINT fk_src_organizer FOREIGN KEY (organizer_user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_src_provider FOREIGN KEY (provider_user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    console.info("[db] Self-heal: created service_request_contracts");
  }

  const [scatT] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS o FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'service_categories' LIMIT 1`,
    [db]
  );
  if (scatT.length) {
    await pool.query(
      `INSERT IGNORE INTO service_categories (name, slug, sort_order) VALUES
        ('Photography & videography', 'photo-video', 55),
        ('Security & crowd management', 'security', 60),
        ('Floral & event decor', 'floral-decor', 65),
        ('Furniture & booth rental', 'furniture-rental', 70),
        ('Cleaning & housekeeping', 'cleaning', 75),
        ('Transport & freight', 'transport-freight', 80),
        ('Permits & compliance help', 'permits-compliance', 85),
        ('Entertainment & artists', 'entertainment', 90),
        ('Registration & badging', 'registration-badging', 95),
        ('Wi-Fi & IT / tech support', 'wifi-it-support', 100),
        ('Power & generators', 'power-generators', 105),
        ('Fire safety & medical standby', 'fire-safety-medical', 110),
        ('Uniforms & staffing', 'uniforms-staffing', 115),
        ('Printing & signage on-site', 'printing-signage', 120),
        ('Waste & sustainability', 'waste-sustainability', 125)`
    );
  }

  await pool.query(
    `INSERT IGNORE INTO roles (code, name, sort_order) VALUES ('VOLUNTEER', 'Volunteer', 7)`
  );

  const [ovT] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS o FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'organizer_volunteers' LIMIT 1`,
    [db]
  );
  if (!ovT.length) {
    await pool.query(
      `CREATE TABLE organizer_volunteers (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        organizer_user_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(32) NOT NULL,
        photo_url VARCHAR(512) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_ov_organizer_user (organizer_user_id, user_id),
        INDEX idx_ov_organizer (organizer_user_id),
        CONSTRAINT fk_ov_organizer FOREIGN KEY (organizer_user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_ov_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    console.info("[db] Self-heal: created organizer_volunteers");
  }

  const [evaT] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS o FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'event_volunteer_assignments' LIMIT 1`,
    [db]
  );
  if (!evaT.length) {
    await pool.query(
      `CREATE TABLE event_volunteer_assignments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        event_id BIGINT UNSIGNED NOT NULL,
        volunteer_id BIGINT UNSIGNED NOT NULL,
        assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_eva_event_volunteer (event_id, volunteer_id),
        INDEX idx_eva_volunteer (volunteer_id),
        CONSTRAINT fk_eva_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
        CONSTRAINT fk_eva_volunteer FOREIGN KEY (volunteer_id) REFERENCES organizer_volunteers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    console.info("[db] Self-heal: created event_volunteer_assignments");
  }
}
