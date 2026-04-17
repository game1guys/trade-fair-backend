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
  ('fees.platform', JSON_OBJECT('enabled', true, 'commissionBpsDefault', 500), NULL),
  ('fees.gst', JSON_OBJECT('enabled', true, 'percent', 18), NULL),
  ('branding', JSON_OBJECT('appName', 'Trade Fair Wala'), NULL),
  ('contact', JSON_OBJECT('supportEmail', '', 'supportPhone', ''), NULL);

