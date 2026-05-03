-- H9 Support & Dispute Management Enhancements

-- Support ticket categories and linkage
ALTER TABLE support_tickets
  ADD COLUMN category ENUM('technical', 'billing', 'stall_booking', 'ticket_booking', 'general', 'dispute') NOT NULL DEFAULT 'general' AFTER role_code,
  ADD COLUMN dispute_id BIGINT UNSIGNED NULL AFTER assigned_to_user_id,
  ADD CONSTRAINT fk_support_dispute FOREIGN KEY (dispute_id) REFERENCES disputes (id) ON DELETE SET NULL;

-- Support ticket messages/responses
CREATE TABLE IF NOT EXISTS support_ticket_responses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  is_staff_response TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_response_ticket (ticket_id),
  CONSTRAINT fk_response_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets (id) ON DELETE CASCADE,
  CONSTRAINT fk_response_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Attachments for support tickets and responses
CREATE TABLE IF NOT EXISTS support_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT UNSIGNED NOT NULL,
  response_id BIGINT UNSIGNED NULL,
  file_url VARCHAR(512) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_attach_ticket (ticket_id),
  CONSTRAINT fk_attach_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets (id) ON DELETE CASCADE,
  CONSTRAINT fk_attach_response FOREIGN KEY (response_id) REFERENCES support_ticket_responses (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Permissions for support management
INSERT IGNORE INTO permissions (code, description) VALUES
  ('admin.support.read', 'View support tickets and responses'),
  ('admin.support.write', 'Manage support tickets and responses');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r INNER JOIN permissions p
WHERE r.code = 'SUPER_ADMIN' AND p.code IN ('admin.support.read', 'admin.support.write');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r INNER JOIN permissions p
WHERE r.code = 'SUB_ADMIN' AND p.code IN ('admin.support.read', 'admin.support.write');
