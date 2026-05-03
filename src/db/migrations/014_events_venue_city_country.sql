-- City / country for venue (structured; geo still on latitude/longitude)
ALTER TABLE events
  ADD COLUMN venue_city VARCHAR(128) NULL AFTER venue_name,
  ADD COLUMN venue_country VARCHAR(128) NULL AFTER venue_city;
