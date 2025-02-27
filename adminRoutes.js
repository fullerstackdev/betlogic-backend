require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const { requireAuth, requireAdmin, requireSuperadmin } = require("./authMiddleware");

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
  // If your DB requires SSL on Render or another host, uncomment:
  // ssl: { rejectUnauthorized: false }
});

/* =========================
   1) MANAGE USERS
   ========================= */

/**
 * GET /api/admin/users
 * Admin or superadmin only. Returns all users.
 */
router.get("/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, role, status, first_name, last_name,
              paypal_email, bank_name, created_at, updated_at
       FROM users
       ORDER BY id`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("// admin get users error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/admin/users/promote
 * Body: { userId, newRole }
 * superadmin only if you prefer. or admin if you allow all admins to do it.
 */
router.post("/users/promote", requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const { userId, newRole } = req.body;
    if (!userId || !newRole) {
      return res.status(400).json({ error: "Missing userId or newRole" });
    }
    const updateRes = await pool.query(
      `UPDATE users SET role=$1, updated_at=NOW()
       WHERE id=$2
       RETURNING id, email, role, status`,
      [newRole, userId]
    );
    if (updateRes.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({
      message: "User promoted/role changed",
      user: updateRes.rows[0]
    });
  } catch (err) {
    console.error("// admin promote error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/admin/users/deactivate
 * Body: { userId }
 * admin can do this if you want.
 */
router.post("/users/deactivate", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }
    const updateRes = await pool.query(
      `UPDATE users SET status='deactivated', updated_at=NOW()
       WHERE id=$1
       RETURNING id, email, role, status`,
      [userId]
    );
    if (updateRes.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({
      message: "User deactivated",
      user: updateRes.rows[0]
    });
  } catch (err) {
    console.error("// admin deactivate error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/admin/users/:id
 * edit user details (first_name, last_name, bank_name, etc.)
 * Body: { first_name, last_name, paypal_email, bank_name }
 */
router.patch("/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { first_name, last_name, paypal_email, bank_name } = req.body;

    const fields = [];
    const values = [];
    let updateQuery = "UPDATE users SET updated_at=NOW()";

    if (first_name !== undefined) {
      fields.push("first_name=$" + (fields.length+1));
      values.push(first_name);
    }
    if (last_name !== undefined) {
      fields.push("last_name=$" + (fields.length+1));
      values.push(last_name);
    }
    if (paypal_email !== undefined) {
      fields.push("paypal_email=$" + (fields.length+1));
      values.push(paypal_email);
    }
    if (bank_name !== undefined) {
      fields.push("bank_name=$" + (fields.length+1));
      values.push(bank_name);
    }

    if (fields.length === 0) {
      return res.json({ message: "No changes" });
    }

    updateQuery += ", " + fields.join(", ");
    updateQuery += " WHERE id=$" + (fields.length+1);
    updateQuery += " RETURNING id, email, role, status, first_name, last_name, paypal_email, bank_name, updated_at";
    values.push(userId);

    const updateRes = await pool.query(updateQuery, values);
    if (updateRes.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({
      message: "User updated",
      user: updateRes.rows[0]
    });
  } catch (err) {
    console.error("// admin edit user error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   2) ADMIN FINANCES
   ========================= */

/**
 * GET /api/admin/finances
 * returns all transactions
 */
router.get("/finances", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.user_id, t.from_account, t.to_account,
              t.amount, t.type, t.description, t.status,
              t.date, t.created_at, t.updated_at
       FROM transactions t
       ORDER BY t.id DESC`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("// admin finances error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/admin/finances
 * create a transaction for any user
 * Body: { user_id, from_account, to_account, amount, type, description, status }
 */
router.post("/finances", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { user_id, from_account, to_account, amount, type, description, status } = req.body;
    if (!user_id || !from_account || !to_account || !amount) {
      return res.status(400).json({ error: "Missing user_id, from_account, to_account, or amount" });
    }
    const insertRes = await pool.query(
      `INSERT INTO transactions
         (user_id, from_account, to_account, amount, type, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, from_account, to_account, amount, type, description, status`,
      [
        user_id,
        from_account,
        to_account,
        amount,
        type || "Deposit",
        description || null,
        status || "Pending"
      ]
    );
    return res.json({
      message: "Transaction created by admin",
      transaction: insertRes.rows[0]
    });
  } catch (err) {
    console.error("// admin create tx error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/admin/finances/:id
 * override or confirm a transaction
 * Body: { amount, type, description, status }
 */
router.patch("/finances/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const txId = req.params.id;
    const { amount, type, description, status } = req.body;

    const fields = [];
    const values = [];
    let updateQuery = "UPDATE transactions SET updated_at=NOW()";

    if (amount !== undefined) {
      fields.push("amount=$" + (fields.length+1));
      values.push(amount);
    }
    if (type !== undefined) {
      fields.push("type=$" + (fields.length+1));
      values.push(type);
    }
    if (description !== undefined) {
      fields.push("description=$" + (fields.length+1));
      values.push(description);
    }
    if (status !== undefined) {
      fields.push("status=$" + (fields.length+1));
      values.push(status);
    }
    if (fields.length === 0) {
      return res.json({ message: "No changes" });
    }

    updateQuery += ", " + fields.join(", ");
    updateQuery += " WHERE id=$" + (fields.length+1);
    updateQuery += " RETURNING *";
    values.push(txId);

    const updateRes = await pool.query(updateQuery, values);
    if (updateRes.rowCount === 0) {
      return res.status(404).json({ error: "Transaction not found" });
    }
    return res.json({
      message: "Transaction updated by admin",
      transaction: updateRes.rows[0]
    });
  } catch (err) {
    console.error("// admin patch tx error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   3) ADMIN PROMOTIONS
   ========================= */

/**
 * GET /api/admin/promotions
 * returns all promotions
 */
router.get("/promotions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, description, image_url,
              start_date, end_date, sportsbook_name, status,
              created_at, updated_at
       FROM promotions
       ORDER BY id DESC`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("// admin get promos error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/admin/promotions
 * create a promotion
 * Body: { title, description, image_url, start_date, end_date, sportsbook_name, status }
 */
router.post("/promotions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, description, image_url, start_date, end_date, sportsbook_name, status } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Missing title" });
    }
    const insertRes = await pool.query(
      `INSERT INTO promotions
         (title, description, image_url, start_date, end_date, sportsbook_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        title,
        description || null,
        image_url || null,
        start_date || null,
        end_date || null,
        sportsbook_name || null,
        status || "active"
      ]
    );
    return res.json({
      message: "Promotion created by admin",
      promotion: insertRes.rows[0]
    });
  } catch (err) {
    console.error("// admin create promo error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/admin/promotions/:id
 * edit promotion
 */
router.patch("/promotions/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const promoId = req.params.id;
    const {
      title,
      description,
      image_url,
      start_date,
      end_date,
      sportsbook_name,
      status
    } = req.body;

    const fields = [];
    const values = [];
    let updateQuery = "UPDATE promotions SET updated_at=NOW()";

    function pushField(fieldName, val) {
      fields.push(fieldName + "=$" + (fields.length+1));
      values.push(val);
    }
    if (title !== undefined) pushField("title", title);
    if (description !== undefined) pushField("description", description);
    if (image_url !== undefined) pushField("image_url", image_url);
    if (start_date !== undefined) pushField("start_date", start_date);
    if (end_date !== undefined) pushField("end_date", end_date);
    if (sportsbook_name !== undefined) pushField("sportsbook_name", sportsbook_name);
    if (status !== undefined) pushField("status", status);

    if (fields.length === 0) {
      return res.json({ message: "No changes" });
    }

    updateQuery += ", " + fields.join(", ");
    updateQuery += " WHERE id=$" + (fields.length+1);
    updateQuery += " RETURNING *";
    values.push(promoId);

    const updateRes = await pool.query(updateQuery, values);
    if (updateRes.rowCount === 0) {
      return res.status(404).json({ error: "Promotion not found" });
    }
    return res.json({
      message: "Promotion updated by admin",
      promotion: updateRes.rows[0]
    });
  } catch (err) {
    console.error("// admin edit promo error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   4) ADMIN TASKS
   ========================= */

/**
 * GET /api/admin/tasks
 * returns all tasks
 */
router.get("/tasks", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, user_id, title, description, status, created_by, created_at, updated_at
       FROM tasks
       ORDER BY id DESC`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("// admin get tasks error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/admin/tasks
 * create a task for any user
 * Body: { user_id, title, description, status }
 */
router.post("/tasks", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { user_id, title, description, status } = req.body;
    if (!user_id || !title) {
      return res.status(400).json({ error: "Missing user_id or title" });
    }
    const adminId = req.user.userId;
    const insertRes = await pool.query(
      `INSERT INTO tasks (user_id, title, description, status, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        user_id,
        title,
        description || null,
        status || "todo",
        adminId
      ]
    );
    return res.json({
      message: "Task created by admin",
      task: insertRes.rows[0]
    });
  } catch (err) {
    console.error("// admin create task error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   5) ADMIN BETS
   ========================= */

/**
 * GET /api/admin/bets
 * returns all bets
 */
router.get("/bets", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, user_id, date, matchup, amount, result, profit, created_at, updated_at
       FROM bets
       ORDER BY id DESC`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("// admin get bets error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/admin/bets
 * create a bet for any user
 * Body: { user_id, date, matchup, amount, result, profit }
 */
router.post("/bets", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { user_id, date, matchup, amount, result, profit } = req.body;
    if (!user_id || !amount) {
      return res.status(400).json({ error: "Missing user_id or amount" });
    }
    const finalDate = date || new Date().toISOString().slice(0,10);
    const finalMatchup = matchup || "";
    const finalAmount = parseFloat(amount) || 0;
    const finalResult = result || "Open";
    const finalProfit = parseFloat(profit) || 0;

    const insertRes = await pool.query(
      `INSERT INTO bets (user_id, date, matchup, amount, result, profit)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        user_id,
        finalDate,
        finalMatchup,
        finalAmount,
        finalResult,
        finalProfit
      ]
    );
    return res.json({
      message: "Bet created by admin",
      bet: insertRes.rows[0]
    });
  } catch (err) {
    console.error("// admin create bet error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   6) ADMIN MESSAGES
   ========================= */

/**
 * GET /api/admin/messages
 * default approach: admin sees only threads they're in. If you want them to see all threads, remove the participant check logic in your messages logic. For now, we keep it simple.
 */
router.get("/messages", requireAuth, requireAdmin, async (req, res) => {
  try {
    const adminId = req.user.userId;
    // find all threads where this admin is a participant
    const query = `
      SELECT t.id, t.title, t.created_at
      FROM thread_participants tp
      JOIN threads t ON tp.thread_id = t.id
      WHERE tp.user_id = $1
      ORDER BY t.created_at DESC
    `;
    const result = await pool.query(query, [adminId]);
    return res.json(result.rows);
  } catch (err) {
    console.error("// admin messages error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

