const express = require("express");
const router = express.Router();
const { Pool } = require("pg");
const { requireAuth } = require("./authMiddleware");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// GET: Company financial overview
router.get("/overview", requireAuth, async (req, res) => {
  try {
    const totalDepositsRes = await pool.query(
      "SELECT SUM(amount) AS total FROM transactions WHERE type='deposit';"
    );
    const totalWithdrawalsRes = await pool.query(
      "SELECT SUM(amount) AS total FROM transactions WHERE type='withdrawal';"
    );

    const totalDeposits = totalDepositsRes.rows[0].total || 0;
    const totalWithdrawals = totalWithdrawalsRes.rows[0].total || 0;
    const netBalance = totalDeposits - totalWithdrawals;

    res.json({
      totalDeposits,
      totalWithdrawals,
      netBalance,
    });
  } catch (err) {
    console.error("Overview error:", err);
    res.status(500).json({ error: "Failed to fetch company overview" });
  }
});

// GET: All transactions or filtered by user
router.get("/", requireAuth, async (req, res) => {
  const { user_id } = req.query;

  try {
    let query = `
      SELECT transactions.*, users.first_name, users.last_name
      FROM transactions
      JOIN users ON transactions.user_id = users.id
    `;
    const params = [];

    if (user_id) {
      query += " WHERE user_id = $1";
      params.push(user_id);
    }

    query += " ORDER BY transactions.created_at DESC";

    const result = await pool.query(query, params);
    res.json({ transactions: result.rows });
  } catch (err) {
    console.error("Transactions error:", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// GET: Detailed financial info for a specific user
router.get("/user/:userId", requireAuth, async (req, res) => {
  const { userId } = req.params;

  try {
    const userInfoRes = await pool.query(
      "SELECT first_name, last_name, email FROM users WHERE id=$1",
      [userId]
    );

    const userTransactionsRes = await pool.query(
      "SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC",
      [userId]
    );

    res.json({
      user: userInfoRes.rows[0],
      transactions: userTransactionsRes.rows,
    });
  } catch (err) {
    console.error("User detail error:", err);
    res.status(500).json({ error: "Failed to fetch user details" });
  }
});

module.exports = router;
