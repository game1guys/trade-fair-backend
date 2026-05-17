-- Per-organizer-plan stall booking commission (basis points). Service-provider plans use 0.
ALTER TABLE subscription_plans
  ADD COLUMN stall_booking_commission_bps INT UNSIGNED NOT NULL DEFAULT 0
  AFTER limitations_json;

-- Backfill existing organizer-targeted plans (legacy installs)
UPDATE subscription_plans
SET stall_booking_commission_bps = 1000
WHERE UPPER(COALESCE(target_role_code, 'ORGANIZER')) = 'ORGANIZER' AND stall_booking_commission_bps = 0;

UPDATE subscription_plans SET stall_booking_commission_bps = 0 WHERE UPPER(target_role_code) = 'SERVICE_PROVIDER';

-- Default free tiers (idempotent)
INSERT INTO subscription_plans (name, description, price_minor, duration_days, active, target_role_code, limitations_json, stall_booking_commission_bps)
SELECT 'Organizer Free', 'List up to 3 fairs; no platform % on stall bookings on this tier.', 0, 36500, 1, 'ORGANIZER',
       JSON_OBJECT('maxEventsTotal', 3, 'maxPublishedEvents', 3), 0
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE name = 'Organizer Free' LIMIT 1);

INSERT INTO subscription_plans (name, description, price_minor, duration_days, active, target_role_code, limitations_json, stall_booking_commission_bps)
SELECT 'Service provider Free', 'Up to 3 published service listings on this tier.', 0, 36500, 1, 'SERVICE_PROVIDER',
       JSON_OBJECT('maxPublishedServices', 3, 'maxServicesTotal', 3), 0
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE name = 'Service provider Free' LIMIT 1);
