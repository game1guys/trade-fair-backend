-- Organizer → service provider ratings (fair organisers score providers they work with).
-- Optional profile field: years in business (shown to organisers on marketplace).

ALTER TABLE service_provider_profiles
  ADD COLUMN years_in_business SMALLINT UNSIGNED NULL COMMENT 'Optional; shown to organisers browsing listings' AFTER booking_enabled;

CREATE TABLE IF NOT EXISTS organizer_provider_ratings (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
