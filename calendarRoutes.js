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
 * GET /api/calendar
 * - normal user => their events
 * - admin => all events or optionally ?user_id=xx
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const { userId, role } = req.user;
    let baseQuery = `
      SELECT id, user_id, date, title, is_blocked, created_at, updated_at
      FROM calendar_events
    `;
    let params = [];
    let whereClause = "";

    if (role === "admin" || role === "superadmin") {
      // optionally check query param user_id
      const queryUserId = req.query.user_id;
      if (queryUserId) {
        whereClause = "WHERE user_id=$1";
        params = [queryUserId];
      }
    } else {
      // normal user => only their events
      whereClause = "WHERE user_id=$1";
      params = [userId];
    }

    const query = `${baseQuery} ${whereClause} ORDER BY date DESC`;
    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("// get calendar error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/calendar
 * expects { date, title, is_blocked, user_id? }
 * - normal user => forced to create for themselves
 * - admin => can pass user_id to create for that user
 */
router.post("/", requireAuth, async (req, res) => {
  try {
    const { userId, role } = req.user;
    let { date, title, is_blocked, user_id } = req.body;

    // parse
    date = date || new Date().toISOString().slice(0,10);
    title = title || "";
    is_blocked = (is_blocked === true || is_blocked === "true");
    // normal user => must create for themselves
    let assignedUserId = userId;
    // admin => can assign to another user
    if ((role === "admin" || role === "superadmin") && user_id) {
      assignedUserId = user_id;
    }

    const insertRes = await pool.query(
      `INSERT INTO calendar_events (user_id, date, title, is_blocked)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, date, title, is_blocked, created_at, updated_at`,
      [assignedUserId, date, title, is_blocked]
    );
    return res.json({
      message: "Event created",
      event: insertRes.rows[0]
    });
  } catch (err) {
    console.error("// create calendar event error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/calendar/:id
 * optional endpoint if you want to update an event
 * - normal user => can only update their own event
 * - admin => can update any event
 */
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const { userId, role } = req.user;
    const eventId = req.params.id;
    let { date, title, is_blocked } = req.body;

    // fetch event
    const eventRes = await pool.query(
      `SELECT id, user_id, date, title, is_blocked
       FROM calendar_events
       WHERE id=$1`,
      [eventId]
    );
    if (eventRes.rows.length === 0) {
      return res.status(404).json({ error: "Event not found" });
    }
    const event = eventRes.rows[0];

    // if normal user => must be their event
    if (role !== "admin" && role !== "superadmin") {
      if (event.user_id !== userId) {
        return res.status(403).json({ error: "Not your event" });
      }
    }

    const fields = [];
    const values = [];
    let updateQuery = "UPDATE calendar_events SET updated_at=NOW()";

    if (date !== undefined) {
      fields.push("date");
      values.push(date);
    }
    if (title !== undefined) {
      fields.push("title");
      values.push(title);
    }
    if (is_blocked !== undefined) {
      fields.push("is_blocked");
      values.push(is_blocked === true || is_blocked === "true");
    }

    if (fields.length === 0) {
      return res.json({ message: "No changes" });
    }

    // build partial update
    const setParts = fields.map((f, i) => `, ${f}=$${i+1}`);
    updateQuery += setParts.join("");
    updateQuery += ` WHERE id=$${fields.length+1}`;
    updateQuery += ` RETURNING id, user_id, date, title, is_blocked, created_at, updated_at`;
    values.push(eventId);

    const updateRes = await pool.query(updateQuery, values);
    return res.json({
      message: "Event updated",
      event: updateRes.rows[0]
    });
  } catch (err) {
    console.error("// update calendar event error", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
