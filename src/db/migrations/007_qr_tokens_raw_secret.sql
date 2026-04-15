-- Allow app to re-show QR payload for "My tickets" (replace with signed tokens in production).
ALTER TABLE qr_tokens
  ADD COLUMN raw_secret CHAR(64) NULL AFTER secret_hash;
