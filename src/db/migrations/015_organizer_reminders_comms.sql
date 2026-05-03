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
