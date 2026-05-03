-- Phase 1 follow-up: Allow logging invalid scans (no ticket_id)
ALTER TABLE entry_scans MODIFY ticket_id BIGINT UNSIGNED NULL;
