require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const { requireAuth } = require("./authMiddleware");

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl if needed:
  // ssl: { rejectUnauthorized: false },
});

/**
 * GET /api/notifications
 * returns the current user's notifications, newest first
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const query = `
      SELECT id, title, body, read, created_at
      FROM notifications
      WHERE user_id=$1
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return res.json(result.rows);
  } catch (err) {
    console.error("// get notifications error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/notifications/:id
 * mark a notification as read (or update title/body if you want)
 * expects { read: true } or something similar
 */
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const notifId = req.params.id;
    const { read } = req.body;

    // first fetch notification
    const notifRes = await pool.query(
      "SELECT id, user_id FROM notifications WHERE id=$1",
      [notifId]
    );
    if (notifRes.rows.length === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }
    const notif = notifRes.rows[0];
    if (notif.user_id !== userId) {
      return res.status(403).json({ error: "Not your notification" });
    }

    // build partial update
    const fields = [];
    const values = [];
    let updateQuery = "UPDATE notifications SET ";

    // if we pass read in the body, we update it
    if (read !== undefined) {
      fields.push("read=$1");
      values.push(!!read); // force boolean
    }
    if (fields.length === 0) {
      return res.json({ message: "No changes" });
    }
    updateQuery += fields.join(", ");
    updateQuery += " WHERE id=$" + (fields.length + 1);
    updateQuery += " RETURNING id, user_id, title, body, read, created_at";
    values.push(notifId);

    const updateRes = await pool.query(updateQuery, values);
    return res.json({
      message: "Notification updated",
      notification: updateRes.rows[0]
    });
  } catch (err) {
    console.error("// update notification error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * (Optional) POST /api/notifications
 * for an admin or some system function to create a notification for a user
 * expects { user_id, title, body }
 */
router.post("/", requireAuth, async (req, res) => {
  try {
    // if only admin can do this, check if role=admin or superadmin
    // here we skip the role check for simplicity
    const { user_id, title, body } = req.body;
    if (!user_id || !title) {
      return res.status(400).json({ error: "Missing user_id or title" });
    }
    const insertRes = await pool.query(
      `INSERT INTO notifications (user_id, title, body)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, title, body, read, created_at`,
      [user_id, title, body || null]
    );
    return res.json({
      message: "Notification created",
      notification: insertRes.rows[0]
    });
  } catch (err) {
    console.error("// create notification error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
