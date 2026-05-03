-- Trade Fair Wala — migrations 001→016 (same order as repo)
-- mysql -u USER -p DATABASE < trade-fair-backend/db/FULL_SCHEMA_001_through_016_ORDERED.sql


-- ========== 001_baseline.sql ==========
-- Phase 0 baseline schema

CREATE TABLE IF NOT EXISTS roles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT UNSIGNED NOT NULL,
  permission_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(32) NULL,
  status ENUM('active', 'inactive', 'blocked') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT UNSIGNED NOT NULL,
  role_id INT UNSIGNED NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME NULL,
  INDEX idx_rt_user (user_id),
  INDEX idx_rt_hash (token_hash),
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(128) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_actor (actor_user_id),
  INDEX idx_audit_entity (entity_type, entity_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========== 002_seed_roles_permissions.sql ==========
INSERT IGNORE INTO roles (code, name, sort_order) VALUES
  ('SUPER_ADMIN', 'Super Admin', 1),
  ('SUB_ADMIN', 'Sub Admin', 2),
  ('ORGANIZER', 'Organizer', 3),
  ('EXHIBITOR', 'Exhibitor', 4),
  ('SERVICE_PROVIDER', 'Service Provider', 5),
  ('VISITOR', 'Visitor', 6);

INSERT IGNORE INTO permissions (code, description) VALUES
  ('auth.session', 'Manage own session'),
  ('admin.users.read', 'View users'),
  ('admin.users.write', 'Manage users');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'SUPER_ADMIN';

-- ========== 003_refresh_token_jti.sql ==========
ALTER TABLE refresh_tokens
  ADD COLUMN jti CHAR(36) NULL DEFAULT NULL COMMENT 'JWT jti claim' AFTER user_id,
  ADD UNIQUE KEY uq_refresh_tokens_jti (jti);

-- ========== 004_grant_auth_session_all_roles.sql ==========
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.code = 'auth.session';

-- ========== 005_phase1_events_stalls_tickets.sql ==========
-- Phase 1 — Events, stalls, exhibitor bookings, visitor tickets, QR, payments

CREATE TABLE IF NOT EXISTS event_categories (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  slug VARCHAR(128) NOT NULL UNIQUE,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organizer_user_id BIGINT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  venue_name VARCHAR(255) NOT NULL DEFAULT '',
  address TEXT NULL,
  latitude DECIMAL(10, 7) NULL,
  longitude DECIMAL(10, 7) NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  is_b2b TINYINT(1) NOT NULL DEFAULT 1,
  is_b2c TINYINT(1) NOT NULL DEFAULT 1,
  tags JSON NULL,
  status ENUM('draft', 'published', 'cancelled') NOT NULL DEFAULT 'draft',
  published_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_events_org (organizer_user_id),
  INDEX idx_events_status_dates (status, starts_at),
  CONSTRAINT fk_events_org FOREIGN KEY (organizer_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_events_cat FOREIGN KEY (category_id) REFERENCES event_categories (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_media (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  url VARCHAR(1024) NOT NULL,
  media_type ENUM('image', 'video', 'other') NOT NULL DEFAULT 'image',
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_media_event (event_id),
  CONSTRAINT fk_media_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stall_types (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(128) NOT NULL,
  price_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stall_type_event_code (event_id, code),
  CONSTRAINT fk_stall_types_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stalls (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  stall_type_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(64) NOT NULL,
  grid_row SMALLINT NULL,
  grid_col SMALLINT NULL,
  status ENUM('available', 'held', 'booked', 'blocked') NOT NULL DEFAULT 'available',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_stalls_event (event_id),
  INDEX idx_stalls_status (event_id, status),
  CONSTRAINT fk_stalls_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT fk_stalls_type FOREIGN KEY (stall_type_id) REFERENCES stall_types (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stall_holds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  stall_id BIGINT UNSIGNED NOT NULL,
  holder_user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_hold_stall (stall_id),
  INDEX idx_hold_expires (expires_at),
  CONSTRAINT fk_holds_stall FOREIGN KEY (stall_id) REFERENCES stalls (id) ON DELETE CASCADE,
  CONSTRAINT fk_holds_user FOREIGN KEY (holder_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  exhibitor_user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'confirmed', 'cancelled') NOT NULL DEFAULT 'pending',
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  subtotal_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  razorpay_order_id VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_bookings_event (event_id),
  INDEX idx_bookings_exhibitor (exhibitor_user_id),
  CONSTRAINT fk_bookings_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT fk_bookings_exhibitor FOREIGN KEY (exhibitor_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS booking_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL,
  stall_id BIGINT UNSIGNED NOT NULL,
  unit_price_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  CONSTRAINT fk_bi_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
  CONSTRAINT fk_bi_stall FOREIGN KEY (stall_id) REFERENCES stalls (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_types (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(128) NOT NULL,
  price_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  quota INT UNSIGNED NOT NULL DEFAULT 0,
  sold_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tt_event (event_id),
  CONSTRAINT fk_tt_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  visitor_user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'paid', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  total_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  razorpay_order_id VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_to_event (event_id),
  INDEX idx_to_visitor (visitor_user_id),
  CONSTRAINT fk_to_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT fk_to_visitor FOREIGN KEY (visitor_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_order_id BIGINT UNSIGNED NOT NULL,
  ticket_type_id BIGINT UNSIGNED NOT NULL,
  visitor_user_id BIGINT UNSIGNED NOT NULL,
  event_id BIGINT UNSIGNED NOT NULL,
  status ENUM('unused', 'used', 'cancelled') NOT NULL DEFAULT 'unused',
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tickets_order (ticket_order_id),
  INDEX idx_tickets_visitor (visitor_user_id),
  INDEX idx_tickets_event (event_id),
  CONSTRAINT fk_tickets_order FOREIGN KEY (ticket_order_id) REFERENCES ticket_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_tickets_type FOREIGN KEY (ticket_type_id) REFERENCES ticket_types (id) ON DELETE CASCADE,
  CONSTRAINT fk_tickets_visitor FOREIGN KEY (visitor_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_tickets_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qr_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT UNSIGNED NOT NULL UNIQUE,
  secret_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qr_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS entry_scans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT UNSIGNED NOT NULL,
  event_id BIGINT UNSIGNED NOT NULL,
  scanned_by_user_id BIGINT UNSIGNED NOT NULL,
  result ENUM('valid', 'invalid', 'already_used', 'wrong_event') NOT NULL,
  scanned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_scans_ticket (ticket_id),
  INDEX idx_scans_event_time (event_id, scanned_at),
  CONSTRAINT fk_es_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE,
  CONSTRAINT fk_es_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT fk_es_scanner FOREIGN KEY (scanned_by_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payer_user_id BIGINT UNSIGNED NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status ENUM('created', 'authorized', 'captured', 'failed') NOT NULL DEFAULT 'created',
  razorpay_order_id VARCHAR(255) NULL,
  razorpay_payment_id VARCHAR(255) NULL,
  booking_id BIGINT UNSIGNED NULL,
  ticket_order_id BIGINT UNSIGNED NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pay_booking (booking_id),
  INDEX idx_pay_ticket_order (ticket_order_id),
  CONSTRAINT fk_pay_payer FOREIGN KEY (payer_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_pay_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE SET NULL,
  CONSTRAINT fk_pay_ticket_order FOREIGN KEY (ticket_order_id) REFERENCES ticket_orders (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payment_id BIGINT UNSIGNED NOT NULL,
  invoice_number VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoices_number (invoice_number),
  CONSTRAINT fk_inv_payment FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refunds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payment_id BIGINT UNSIGNED NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  status ENUM('requested', 'approved', 'rejected', 'processed') NOT NULL DEFAULT 'requested',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ref_payment FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========== 006_seed_event_categories.sql ==========
INSERT IGNORE INTO event_categories (name, slug, sort_order) VALUES
  ('Trade & Commerce', 'trade-commerce', 1),
  ('Technology', 'technology', 2),
  ('Lifestyle', 'lifestyle', 3),
  ('Agriculture', 'agriculture', 4);

-- ========== 007_qr_tokens_raw_secret.sql ==========
-- Allow app to re-show QR payload for "My tickets" (replace with signed tokens in production).
ALTER TABLE qr_tokens
  ADD COLUMN raw_secret CHAR(64) NULL AFTER secret_hash;

-- ========== 008_ticket_orders_line.sql ==========
ALTER TABLE ticket_orders
  ADD COLUMN ticket_type_id BIGINT UNSIGNED NULL AFTER visitor_user_id,
  ADD COLUMN quantity INT UNSIGNED NOT NULL DEFAULT 1 AFTER ticket_type_id,
  ADD CONSTRAINT fk_to_ticket_type FOREIGN KEY (ticket_type_id) REFERENCES ticket_types (id) ON DELETE SET NULL;

-- ========== 009_phase1_completion.sql ==========
-- Phase 1 completion: exhibitor profile, announcements, refund request flag

CREATE TABLE IF NOT EXISTS exhibitor_profiles (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  company_name VARCHAR(255) NULL,
  city VARCHAR(128) NULL,
  state VARCHAR(128) NULL,
  country VARCHAR(128) NULL DEFAULT 'India',
  interests JSON NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_exh_prof_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_announcements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  audience ENUM('exhibitors', 'visitors', 'both') NOT NULL DEFAULT 'both',
  title VARCHAR(255) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ann_event (event_id),
  CONSTRAINT fk_ann_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT fk_ann_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE bookings ADD COLUMN refund_requested_at DATETIME NULL;

-- ========== 010_phase2_trust_ops.sql ==========
-- Phase 2 — Trust & Operations

-- Permissions for admin modules (seed)
INSERT IGNORE INTO permissions (code, description) VALUES
  ('admin.kyc.read', 'View KYC documents'),
  ('admin.kyc.write', 'Review KYC documents'),
  ('admin.sub_admins.write', 'Manage sub-admin accounts'),
  ('admin.scopes.write', 'Manage sub-admin scopes'),
  ('admin.support.read', 'View support tickets'),
  ('admin.support.write', 'Manage support tickets'),
  ('admin.notifications.write', 'Manage notifications'),
  ('admin.moderation.read', 'View moderation flags'),
  ('admin.moderation.write', 'Manage moderation flags'),
  ('admin.settings.read', 'View system settings'),
  ('admin.settings.write', 'Manage system settings'),
  ('admin.transactions.read', 'View transactions');

-- Super admin gets all permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
WHERE r.code = 'SUPER_ADMIN';

CREATE TABLE IF NOT EXISTS kyc_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  role_code VARCHAR(32) NOT NULL,
  doc_type VARCHAR(64) NOT NULL,
  doc_url VARCHAR(1024) NOT NULL,
  meta_json JSON NULL,
  status ENUM('submitted','approved','rejected') NOT NULL DEFAULT 'submitted',
  remarks TEXT NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_kyc_user (user_id),
  INDEX idx_kyc_status (status),
  INDEX idx_kyc_role (role_code),
  CONSTRAINT fk_kyc_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_kyc_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sub_admin_scopes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sub_admin_user_id BIGINT UNSIGNED NOT NULL,
  scope_code VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_scope_user (sub_admin_user_id, scope_code),
  INDEX idx_scope_user (sub_admin_user_id),
  CONSTRAINT fk_scope_user FOREIGN KEY (sub_admin_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  role_code VARCHAR(32) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  status ENUM('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
  priority ENUM('low','normal','high') NOT NULL DEFAULT 'normal',
  assigned_to_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_support_creator (created_by_user_id),
  INDEX idx_support_status (status),
  INDEX idx_support_assignee (assigned_to_user_id),
  CONSTRAINT fk_support_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_support_assignee FOREIGN KEY (assigned_to_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Minimal disputes table (stub for Phase 2)
CREATE TABLE IF NOT EXISTS disputes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payment_id BIGINT UNSIGNED NULL,
  status ENUM('open','resolved','closed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_disputes_payment (payment_id),
  CONSTRAINT fk_disputes_payment FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  audience ENUM('all','organizers','exhibitors','visitors') NOT NULL DEFAULT 'all',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  template_id BIGINT UNSIGNED NULL,
  to_user_id BIGINT UNSIGNED NULL,
  channel ENUM('inapp','email','whatsapp') NOT NULL DEFAULT 'inapp',
  payload_json JSON NULL,
  status ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_to (to_user_id),
  INDEX idx_notif_status (status),
  CONSTRAINT fk_notif_tpl FOREIGN KEY (template_id) REFERENCES notification_templates (id) ON DELETE SET NULL,
  CONSTRAINT fk_notif_user FOREIGN KEY (to_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_flags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  status ENUM('open','approved','rejected') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_flags_entity (entity_type, entity_id),
  INDEX idx_flags_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  `key` VARCHAR(128) NOT NULL PRIMARY KEY,
  value_json JSON NOT NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_settings_user FOREIGN KEY (updated_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ========== 011_phase2_subadmin_permissions.sql ==========
-- Phase 2 follow-up: allow SUB_ADMIN to access admin modules via scopes.
-- Permissions are still restricted by requireSubAdminScope().

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
INNER JOIN permissions p ON p.code LIKE 'admin.%'
WHERE r.code = 'SUB_ADMIN';


-- ========== 012_phase3_marketplace.sql ==========
-- Phase 3 — Marketplace & Monetization

INSERT IGNORE INTO permissions (code, description) VALUES
  ('admin.monetization.read', 'View monetization, subscriptions, refunds'),
  ('admin.monetization.write', 'Manage monetization rules, subscriptions, refunds');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r INNER JOIN permissions p
WHERE r.code = 'SUPER_ADMIN' AND p.code IN ('admin.monetization.read', 'admin.monetization.write');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r INNER JOIN permissions p
WHERE r.code = 'SUB_ADMIN' AND p.code IN ('admin.monetization.read', 'admin.monetization.write');

CREATE TABLE IF NOT EXISTS service_categories (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  slug VARCHAR(128) NOT NULL UNIQUE,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO service_categories (name, slug, sort_order) VALUES
  ('Stall design & fabrication', 'stall-design', 10),
  ('AV & lighting', 'av-lighting', 20),
  ('Catering', 'catering', 30),
  ('Logistics', 'logistics', 40),
  ('Marketing & branding', 'marketing', 50);

CREATE TABLE IF NOT EXISTS service_provider_profiles (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  tagline VARCHAR(512) NULL,
  city VARCHAR(128) NULL,
  state VARCHAR(128) NULL,
  portfolio_urls JSON NULL,
  public_slug VARCHAR(64) NULL UNIQUE,
  booking_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_spp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS services (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  provider_user_id BIGINT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NOT NULL,
  event_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  price_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  portfolio_urls JSON NULL,
  status ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_services_provider (provider_user_id),
  INDEX idx_services_cat (category_id),
  INDEX idx_services_event (event_id),
  INDEX idx_services_status (status),
  CONSTRAINT fk_services_provider FOREIGN KEY (provider_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_services_cat FOREIGN KEY (category_id) REFERENCES service_categories (id),
  CONSTRAINT fk_services_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS service_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  service_id BIGINT UNSIGNED NOT NULL,
  from_user_id BIGINT UNSIGNED NOT NULL,
  message TEXT NOT NULL,
  status ENUM('open', 'in_progress', 'closed') NOT NULL DEFAULT 'open',
  provider_response TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sr_service (service_id),
  INDEX idx_sr_from (from_user_id),
  CONSTRAINT fk_sr_service FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE CASCADE,
  CONSTRAINT fk_sr_from FOREIGN KEY (from_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS service_bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  service_request_id BIGINT UNSIGNED NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  customer_user_id BIGINT UNSIGNED NOT NULL,
  provider_user_id BIGINT UNSIGNED NOT NULL,
  scheduled_at DATETIME NULL,
  amount_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status ENUM('pending_payment', 'confirmed', 'rejected', 'completed', 'cancelled') NOT NULL DEFAULT 'pending_payment',
  razorpay_order_id VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sb_service (service_id),
  INDEX idx_sb_customer (customer_user_id),
  INDEX idx_sb_provider (provider_user_id),
  CONSTRAINT fk_sb_req FOREIGN KEY (service_request_id) REFERENCES service_requests (id) ON DELETE SET NULL,
  CONSTRAINT fk_sb_service FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE CASCADE,
  CONSTRAINT fk_sb_customer FOREIGN KEY (customer_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_sb_provider FOREIGN KEY (provider_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS service_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  service_id BIGINT UNSIGNED NOT NULL,
  booking_id BIGINT UNSIGNED NOT NULL,
  reviewer_user_id BIGINT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_review_booking (booking_id),
  INDEX idx_rev_service (service_id),
  CONSTRAINT fk_rev_service FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE CASCADE,
  CONSTRAINT fk_rev_booking FOREIGN KEY (booking_id) REFERENCES service_bookings (id) ON DELETE CASCADE,
  CONSTRAINT fk_rev_user FOREIGN KEY (reviewer_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS commission_rules (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  scope_type ENUM('global', 'event', 'service_category') NOT NULL,
  event_id BIGINT UNSIGNED NULL,
  service_category_id INT UNSIGNED NULL,
  commission_bps INT UNSIGNED NOT NULL DEFAULT 1000,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cr_event (event_id),
  INDEX idx_cr_cat (service_category_id),
  CONSTRAINT fk_cr_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT fk_cr_cat FOREIGN KEY (service_category_id) REFERENCES service_categories (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO commission_rules (scope_type, event_id, service_category_id, commission_bps, active)
SELECT 'global', NULL, NULL, 1000, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM commission_rules WHERE scope_type = 'global' LIMIT 1);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  price_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  duration_days INT UNSIGNED NOT NULL DEFAULT 30,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO subscription_plans (name, description, price_minor, duration_days, active)
SELECT 'Platform Starter', 'Reduced commission during subscription window', 99900, 30, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans LIMIT 1);

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  plan_id INT UNSIGNED NOT NULL,
  status ENUM('active', 'cancelled', 'expired') NOT NULL DEFAULT 'active',
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sub_user (user_id),
  INDEX idx_sub_plan (plan_id),
  CONSTRAINT fk_sub_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_sub_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE payments
  ADD COLUMN service_booking_id BIGINT UNSIGNED NULL AFTER ticket_order_id,
  ADD INDEX idx_pay_service_booking (service_booking_id);

ALTER TABLE payments
  ADD CONSTRAINT fk_pay_service_booking FOREIGN KEY (service_booking_id) REFERENCES service_bookings (id) ON DELETE SET NULL;

ALTER TABLE refunds
  ADD COLUMN requested_by_user_id BIGINT UNSIGNED NULL AFTER payment_id,
  ADD COLUMN notes TEXT NULL AFTER amount_minor,
  ADD COLUMN razorpay_refund_id VARCHAR(255) NULL AFTER status,
  ADD COLUMN approved_by_user_id BIGINT UNSIGNED NULL AFTER razorpay_refund_id;

ALTER TABLE refunds
  ADD CONSTRAINT fk_refunds_requester FOREIGN KEY (requested_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_refunds_approver FOREIGN KEY (approved_by_user_id) REFERENCES users (id) ON DELETE SET NULL;

INSERT IGNORE INTO system_settings (`key`, value_json, updated_by_user_id) VALUES
  ('platform.revenue_model', JSON_OBJECT('mode', 'commission'), NULL);

-- ========== 013_phase4_admin_suite.sql ==========
-- Phase 4 — Analytics, Reports, Moderation, Settings

INSERT IGNORE INTO permissions (code, description) VALUES
  ('admin.analytics.read', 'View analytics dashboard'),
  ('admin.transactions.read', 'View transaction ledger'),
  ('admin.reports.export', 'Export CSV reports'),
  ('admin.featured.read', 'View featured listings'),
  ('admin.featured.write', 'Manage featured listings');

-- Super admin gets all admin permissions (includes new ones)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
INNER JOIN permissions p ON p.code IN (
  'admin.analytics.read',
  'admin.transactions.read',
  'admin.reports.export',
  'admin.featured.read',
  'admin.featured.write'
)
WHERE r.code = 'SUPER_ADMIN';

-- Sub-admin can access these too (still scope-restricted for phase2 modules; phase4 keeps it simple)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
INNER JOIN permissions p ON p.code IN (
  'admin.analytics.read',
  'admin.transactions.read',
  'admin.reports.export',
  'admin.featured.read',
  'admin.featured.write'
)
WHERE r.code = 'SUB_ADMIN';

CREATE TABLE IF NOT EXISTS featured_listings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  label VARCHAR(255) NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_feature_entity (entity_type, entity_id),
  INDEX idx_feature_active (active, starts_at, ends_at),
  CONSTRAINT fk_feature_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Settings defaults (JSON values)
INSERT IGNORE INTO system_settings (`key`, value_json, updated_by_user_id) VALUES
  ('fees.platform', JSON_OBJECT('enabled', true, 'commissionBpsDefault', 1000), NULL),
  ('fees.gst', JSON_OBJECT('enabled', true, 'percent', 18), NULL),
  ('branding', JSON_OBJECT('appName', 'Trade Fair Wala'), NULL),
  ('contact', JSON_OBJECT('supportEmail', '', 'supportPhone', ''), NULL);


-- ========== 014_events_venue_city_country.sql ==========
-- City / country for venue (structured; geo still on latitude/longitude)
ALTER TABLE events
  ADD COLUMN venue_city VARCHAR(128) NULL AFTER venue_name,
  ADD COLUMN venue_country VARCHAR(128) NULL AFTER venue_city;

-- ========== 015_organizer_reminders_comms.sql ==========
CREATE TABLE IF NOT EXISTS event_reminders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  remind_at DATETIME NOT NULL,
  channel ENUM('email', 'whatsapp', 'both') NOT NULL DEFAULT 'email',
  title VARCHAR(255) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  audience ENUM('exhibitors', 'visitors', 'both') NOT NULL DEFAULT 'both',
  status ENUM('scheduled', 'sent', 'cancelled') NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_er_event_time (event_id, remind_at),
  CONSTRAINT fk_er_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS organizer_communication_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  channel ENUM('email', 'whatsapp', 'in_app') NOT NULL DEFAULT 'in_app',
  audience ENUM('exhibitors', 'visitors', 'both') NOT NULL,
  subject VARCHAR(255) NULL,
  body TEXT NOT NULL,
  recipient_count INT UNSIGNED NOT NULL DEFAULT 0,
  meta JSON NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ocl_event (event_id),
  CONSTRAINT fk_ocl_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT fk_ocl_user FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========== 016_organizer_advances.sql ==========
-- Multi-category links (many event_categories per event). Keeps events.category_id for legacy reads.
CREATE TABLE IF NOT EXISTS event_category_links (
  event_id BIGINT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (event_id, category_id),
  CONSTRAINT fk_ecl_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT fk_ecl_cat FOREIGN KEY (category_id) REFERENCES event_categories (id) ON DELETE CASCADE,
  INDEX idx_ecl_cat (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO event_category_links (event_id, category_id)
SELECT id, category_id FROM events WHERE category_id IS NOT NULL;

ALTER TABLE events ADD COLUMN require_booking_approval TINYINT(1) NOT NULL DEFAULT 0 AFTER tags;

-- Organizer approval gate before payment on stall bookings
ALTER TABLE bookings MODIFY COLUMN status ENUM(
  'pending_approval',
  'pending',
  'confirmed',
  'cancelled'
) NOT NULL DEFAULT 'pending';
