-- Gate volunteers: organiser pool + per-event assignments (login as VOLUNTEER role).
INSERT IGNORE INTO roles (code, name, sort_order) VALUES ('VOLUNTEER', 'Volunteer', 7);

CREATE TABLE IF NOT EXISTS organizer_volunteers (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_volunteer_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  volunteer_id BIGINT UNSIGNED NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_eva_event_volunteer (event_id, volunteer_id),
  INDEX idx_eva_volunteer (volunteer_id),
  CONSTRAINT fk_eva_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT fk_eva_volunteer FOREIGN KEY (volunteer_id) REFERENCES organizer_volunteers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
