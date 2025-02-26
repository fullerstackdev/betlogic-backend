require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const { requireAuth } = require("./authMiddleware"); // adjust the path if needed

const router = express.Router();

// Create a PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // if needed, uncomment:
  // ssl: { rejectUnauthorized: false },
});

/**
 * GET /api/finances/accounts
 * Returns the user's accounts.
 */
router.get("/accounts", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query(
      "SELECT id, name, balance FROM accounts WHERE user_id = $1 ORDER BY id",
      [userId]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("// finances accounts error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/finances/transactions
 * Returns the user's transactions with account names.
 */
router.get("/transactions", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const query = `
      SELECT t.id, t.date, t.amount, t.type, t.description, t.status,
             a_from.name AS from_account_name,
             a_to.name AS to_account_name
      FROM transactions t
      JOIN accounts a_from ON t.from_account = a_from.id
      JOIN accounts a_to   ON t.to_account = a_to.id
      WHERE t.user_id = $1
      ORDER BY t.created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return res.json(result.rows);
  } catch (err) {
    console.error("// finances transactions error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/finances/transactions
 * Expects a JSON body with:
 * { fromAccount, toAccount, amount, type, description, status? }
 */
router.post("/transactions", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    let { fromAccount, toAccount, amount, type, description, status } = req.body;

    // Basic validation
    if (!fromAccount || !toAccount || !amount) {
      return res.status(400).json({ error: "Missing fromAccount, toAccount, or amount" });
    }

    // Parse and validate amount
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Default status to "Pending" if not provided
    status = status || "Pending";

    const query = `
      INSERT INTO transactions
        (user_id, from_account, to_account, amount, type, description, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, date, amount, type, description, status
    `;
    const values = [
      userId,
      fromAccount,
      toAccount,
      amt,
      type || "Deposit",
      description || null,
      status,
    ];
    const result = await pool.query(query, values);

    // Optional: If the transaction is confirmed, update the account balances
    if (status === "Confirmed") {
      // Subtract from the sender's account
      await pool.query(
        "UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2",
        [amt, fromAccount]
      );
      // Add to the receiver's account
      await pool.query(
        "UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2",
        [amt, toAccount]
      );
    }

    return res.json({
      message: "Transaction created",
      transaction: result.rows[0],
    });
  } catch (err) {
    console.error("// create transaction error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/finances/accounts
 * Expects a JSON body: { name }
 */
router.post("/accounts", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Missing account name" });
    }
    
    const query = `
      INSERT INTO accounts (user_id, name)
      VALUES ($1, $2)
      RETURNING id, name, balance
    `;
    const result = await pool.query(query, [userId, name]);
    
    return res.json({
      message: "Account created",
      account: result.rows[0],
    });
  } catch (err) {
    console.error("// create account error", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
