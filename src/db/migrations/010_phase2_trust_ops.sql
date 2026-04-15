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

