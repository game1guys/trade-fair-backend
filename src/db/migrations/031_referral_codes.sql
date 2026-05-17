-- Admin referral / festival season codes for organizer & service provider subscriptions.

CREATE TABLE IF NOT EXISTS referral_codes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  label VARCHAR(128) NOT NULL,
  target_role_code ENUM('ORGANIZER', 'SERVICE_PROVIDER') NOT NULL,
  discount_type ENUM('percent', 'fixed_minor') NOT NULL,
  discount_value INT UNSIGNED NOT NULL,
  max_redemptions INT UNSIGNED NULL,
  redemption_count INT UNSIGNED NOT NULL DEFAULT 0,
  valid_from DATETIME NULL,
  valid_until DATETIME NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_referral_code (code),
  INDEX idx_referral_role_active (target_role_code, active),
  CONSTRAINT fk_referral_creator FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_redemptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  referral_code_id INT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  plan_id INT UNSIGNED NOT NULL,
  payment_id BIGINT UNSIGNED NULL,
  subscription_id BIGINT UNSIGNED NULL,
  original_amount_minor BIGINT UNSIGNED NOT NULL,
  discount_minor BIGINT UNSIGNED NOT NULL,
  amount_paid_minor BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_referral_user_code (user_id, referral_code_id),
  INDEX idx_redemption_code (referral_code_id),
  CONSTRAINT fk_redemption_code FOREIGN KEY (referral_code_id) REFERENCES referral_codes (id) ON DELETE CASCADE,
  CONSTRAINT fk_redemption_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_redemption_payment FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE SET NULL,
  CONSTRAINT fk_redemption_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions (id) ON DELETE SET NULL,
  CONSTRAINT fk_redemption_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
