ALTER TABLE ticket_orders
  ADD COLUMN ticket_type_id BIGINT UNSIGNED NULL AFTER visitor_user_id,
  ADD COLUMN quantity INT UNSIGNED NOT NULL DEFAULT 1 AFTER ticket_type_id,
  ADD CONSTRAINT fk_to_ticket_type FOREIGN KEY (ticket_type_id) REFERENCES ticket_types (id) ON DELETE SET NULL;
