-- Organizer settlement: bank / UPI for admin reference; optional Razorpay Route linked account for automatic splits.
CREATE TABLE IF NOT EXISTS organizer_payout_profiles (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  account_holder_name VARCHAR(255) NOT NULL,
  bank_account_number VARCHAR(32) NULL,
  ifsc VARCHAR(20) NULL,
  upi_id VARCHAR(255) NULL,
  razorpay_linked_account_id VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_opp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
