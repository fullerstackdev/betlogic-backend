require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const { requireAuth } = require("./authMiddleware");
// if you want a requireAdmin, we can incorporate that in the logic below

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // if needed:
  // ssl: { rejectUnauthorized: false },
});

/**
 * GET /api/bets
 * - if user.role in ["admin","superadmin"], return all bets
 * - else return only bets for req.user.userId
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const { userId, role } = req.user;
    let query = `
      SELECT id, user_id, date, matchup, amount, result, profit, created_at, updated_at
      FROM bets
      ORDER BY id DESC
    `;
    let params = [];

    if (role !== "admin" && role !== "superadmin") {
      // normal user => filter by user_id
      query = `
        SELECT id, user_id, date, matchup, amount, result, profit, created_at, updated_at
        FROM bets
        WHERE user_id=$1
        ORDER BY id DESC
      `;
      params = [userId];
    }
    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("// get bets error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/bets
 * - if normal user, forced to create bet for themselves
 * - if admin/superadmin, can pass user_id
 * expects { date, matchup, amount, result, profit, user_id? }
 */
router.post("/", requireAuth, async (req, res) => {
  try {
    const { userId, role } = req.user;
    let { date, matchup, amount, result, profit, user_id } = req.body;

    // parse or default
    date = date || new Date().toISOString().slice(0,10);
    matchup = matchup || "";
    amount = parseFloat(amount) || 0;
    result = result || "Open";
    profit = parseFloat(profit) || 0;

    // if normal user, user_id is themselves
    let assignedUserId = userId;
    // if admin, can override
    if ((role === "admin" || role === "superadmin") && user_id) {
      assignedUserId = user_id;
    }

    const insertRes = await pool.query(
      `INSERT INTO bets (user_id, date, matchup, amount, result, profit)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, date, matchup, amount, result, profit, created_at, updated_at`,
      [
        assignedUserId,
        date,
        matchup,
        amount,
        result,
        profit
      ]
    );
    return res.json({
      message: "Bet created",
      bet: insertRes.rows[0]
    });
  } catch (err) {
    console.error("// create bet error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/bets/:id
 * - if normal user, can only patch their own bets
 * - if admin, can patch any user’s bet
 * expects any of { date, matchup, amount, result, profit }
 */
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const { userId, role } = req.user;
    const betId = req.params.id;
    let { date, matchup, amount, result, profit } = req.body;

    // fetch existing bet
    const betRes = await pool.query(
      `SELECT id, user_id, date, matchup, amount, result, profit
       FROM bets
       WHERE id=$1`,
      [betId]
    );
    if (betRes.rows.length === 0) {
      return res.status(404).json({ error: "Bet not found" });
    }
    const bet = betRes.rows[0];

    // if normal user, must be their bet
    if (role !== "admin" && role !== "superadmin") {
      if (bet.user_id !== userId) {
        return res.status(403).json({ error: "Not your bet" });
      }
    }

    const fields = [];
    const values = [];
    let updateQuery = "UPDATE bets SET updated_at=NOW()";

    if (date !== undefined) {
      fields.push("date");
      values.push(date);
    }
    if (matchup !== undefined) {
      fields.push("matchup");
      values.push(matchup);
    }
    if (amount !== undefined) {
      fields.push("amount");
      values.push(parseFloat(amount) || 0);
    }
    if (result !== undefined) {
      fields.push("result");
      values.push(result);
    }
    if (profit !== undefined) {
      fields.push("profit");
      values.push(parseFloat(profit) || 0);
    }

    if (fields.length === 0) {
      return res.json({ message: "No changes" });
    }

    const setParts = fields.map((f, i) => `, ${f}=$${i+1}`);
    updateQuery += setParts.join("");
    updateQuery += ` WHERE id=$${fields.length+1}`;
    updateQuery += ` RETURNING id, user_id, date, matchup, amount, result, profit, created_at, updated_at`;

    values.push(betId);

    const updateRes = await pool.query(updateQuery, values);
    return res.json({
      message: "Bet updated",
      bet: updateRes.rows[0]
    });
  } catch (err) {
    console.error("// update bet error", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
