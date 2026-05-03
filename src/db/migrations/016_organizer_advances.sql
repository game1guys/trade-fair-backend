-- Multi-category links (many event_categories per event). Keeps events.category_id for legacy reads.
CREATE TABLE IF NOT EXISTS event_category_links (
  event_id BIGINT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (event_id, category_id),
  CONSTRAINT fk_ecl_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT fk_ecl_cat FOREIGN KEY (category_id) REFERENCES event_categories (id) ON DELETE CASCADE,
  INDEX idx_ecl_cat (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO event_category_links (event_id, category_id)
SELECT id, category_id FROM events WHERE category_id IS NOT NULL;

ALTER TABLE events ADD COLUMN require_booking_approval TINYINT(1) NOT NULL DEFAULT 0 AFTER tags;

-- Organizer approval gate before payment on stall bookings
ALTER TABLE bookings MODIFY COLUMN status ENUM(
  'pending_approval',
  'pending',
  'confirmed',
  'cancelled'
) NOT NULL DEFAULT 'pending';
