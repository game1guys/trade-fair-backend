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
