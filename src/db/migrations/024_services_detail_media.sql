-- Service listings: gallery images + optional logistics/detail fields for marketplace & organizers.
ALTER TABLE services
  ADD COLUMN cover_image_url VARCHAR(512) NULL AFTER portfolio_urls,
  ADD COLUMN image_urls JSON NULL AFTER cover_image_url,
  ADD COLUMN service_area VARCHAR(255) NULL AFTER image_urls,
  ADD COLUMN lead_time_days SMALLINT UNSIGNED NULL AFTER service_area,
  ADD COLUMN delivery_notes TEXT NULL AFTER lead_time_days;
