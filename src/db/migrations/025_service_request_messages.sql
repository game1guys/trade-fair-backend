-- Threaded in-app chat on service enquiries (organizer/customer ↔ provider).
CREATE TABLE IF NOT EXISTS service_request_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  service_request_id BIGINT UNSIGNED NOT NULL,
  from_user_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_srm_request (service_request_id),
  CONSTRAINT fk_srm_request FOREIGN KEY (service_request_id) REFERENCES service_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_srm_from FOREIGN KEY (from_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
