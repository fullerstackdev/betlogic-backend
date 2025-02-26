CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  balance DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Optionally, add a foreign key constraint:
-- ALTER TABLE accounts
--   ADD CONSTRAINT fk_accounts_user
--   FOREIGN KEY (user_id) REFERENCES users(id)
--   ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  from_account INT NOT NULL,
  to_account INT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount DECIMAL(10,2) NOT NULL,
  type VARCHAR(50) DEFAULT 'Deposit',  -- e.g. Deposit, Withdrawal, Bonus, etc.
  description TEXT,
  status VARCHAR(50) DEFAULT 'Pending',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Optionally, add foreign key constraints:
-- ALTER TABLE transactions
--   ADD CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users(id);
-- ALTER TABLE transactions
--   ADD CONSTRAINT fk_tx_fromacc FOREIGN KEY (from_account) REFERENCES accounts(id);
-- ALTER TABLE transactions
--   ADD CONSTRAINT fk_tx_toacc FOREIGN KEY (to_account) REFERENCES accounts(id);
