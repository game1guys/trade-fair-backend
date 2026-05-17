-- Trade Fair Wala — extra DDL mirrored from `src/db/ensureOptionalSchema.ts`
-- Run AFTER 001–016 if you apply SQL manually (the Node app also runs these checks on boot).
-- If a column/table already exists, MySQL will error on that statement — skip it or run piecemeal.

-- ---------------------------------------------------------------------------
-- events: venue_state (014 already adds venue_city + venue_country)
-- ---------------------------------------------------------------------------
ALTER TABLE events
  ADD COLUMN venue_state VARCHAR(128) NULL AFTER venue_country;

-- ---------------------------------------------------------------------------
-- users: pending admin review gate (organizer / service_provider dashboards)
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN pending_admin_review TINYINT(1) NOT NULL DEFAULT 0 AFTER status;

-- ---------------------------------------------------------------------------
-- support_tickets: SLA columns (Phase 2 base table is in 010)
-- ---------------------------------------------------------------------------
ALTER TABLE support_tickets
  ADD COLUMN sla_first_reply_due_at DATETIME NULL AFTER assigned_to_user_id;

ALTER TABLE support_tickets
  ADD COLUMN sla_resolution_due_at DATETIME NULL AFTER sla_first_reply_due_at;

ALTER TABLE support_tickets
  ADD COLUMN first_staff_action_at DATETIME NULL AFTER sla_resolution_due_at;

-- ---------------------------------------------------------------------------
-- exhibitor: saved fairs (favourites)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exhibitor_event_favorites (
  user_id BIGINT UNSIGNED NOT NULL,
  event_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, event_id),
  INDEX idx_fav_user (user_id),
  INDEX idx_fav_event (event_id),
  CONSTRAINT fk_fav_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_fav_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- bookings.refund_requested_at: already applied in migration 009 / FULL_SCHEMA_001_through_016 — do not repeat.

-- ---------------------------------------------------------------------------
-- users: phone OTP verification timestamp (H5 visitor profile)
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN phone_verified_at DATETIME NULL AFTER phone;
