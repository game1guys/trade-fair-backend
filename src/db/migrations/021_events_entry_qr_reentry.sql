-- Per-event gate policy: when 1, QR scans log valid entry without marking ticket "used" (re-entry / multi-scan).
ALTER TABLE events
  ADD COLUMN entry_qr_allow_reentry TINYINT(1) NOT NULL DEFAULT 0
  COMMENT '1 = allow repeated valid scans; 0 = single-use (first scan marks ticket used)'
  AFTER require_booking_approval;
