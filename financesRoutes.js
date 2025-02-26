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
    const { fromAccount, toAccount, amount, type, description, status } = req.body;

    // Basic validation
    if (!fromAccount || !toAccount || !amount) {
      return res.status(400).json({ error: "Missing fromAccount, toAccount, or amount" });
    }

    // Parse and validate amount
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

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
      status || "Pending",
    ];
    const result = await pool.query(query, values);

    // Optional: Update account balances if using real-time ledger logic.
    // For example, if (status === "Confirmed") { ... }

    return res.json({
      message: "Transaction created",
      transaction: result.rows[0],
    });
  } catch (err) {
    console.error("// create transaction error", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
