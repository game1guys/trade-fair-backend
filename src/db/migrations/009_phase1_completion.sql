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
