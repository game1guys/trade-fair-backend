ALTER TABLE refresh_tokens
  ADD COLUMN jti CHAR(36) NULL DEFAULT NULL COMMENT 'JWT jti claim' AFTER user_id,
  ADD UNIQUE KEY uq_refresh_tokens_jti (jti);
