-- H10 Additional Features: Ratings & reviews for events

CREATE TABLE IF NOT EXISTS event_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  reviewer_user_id BIGINT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL DEFAULT 5,
  comment TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_event_review_event (event_id),
  CONSTRAINT fk_event_review_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT fk_event_review_user FOREIGN KEY (reviewer_user_id) REFERENCES users (id) ON DELETE CASCADE,
  UNIQUE KEY uniq_event_reviewer (event_id, reviewer_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
