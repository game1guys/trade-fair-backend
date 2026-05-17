-- Link marketplace enquiries to an organizer event (optional context for service providers).
ALTER TABLE service_requests
  ADD COLUMN context_event_id BIGINT UNSIGNED NULL AFTER message,
  ADD INDEX idx_sr_context_event (context_event_id),
  ADD CONSTRAINT fk_sr_context_event FOREIGN KEY (context_event_id) REFERENCES events (id) ON DELETE SET NULL;
