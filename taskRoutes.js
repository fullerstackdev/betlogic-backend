require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const { requireAuth } = require("./authMiddleware");
// adjust path to authMiddleware if needed

const router = express.Router();

// create pg pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // if needed for SSL:
  // ssl: { rejectUnauthorized: false },
});

/**
 * GET /api/tasks
 * returns tasks for the current user, grouped by status if you like
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const query = `
      SELECT id, title, description, status, created_by, created_at, updated_at
      FROM tasks
      WHERE user_id=$1
      ORDER BY id DESC
    `;
    const result = await pool.query(query, [userId]);

    // optionally group them by status yourself or just return raw
    return res.json(result.rows);
  } catch (err) {
    console.error("// get tasks error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/tasks
 * create a new task
 * expects { title, description, status? } in req.body
 */
router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;   // the assignee
    // if the app logic says "only the same user can create tasks for themselves," we do that
    // if you want an admin to create tasks for a user, pass userId in body
    const { title, description, status } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Missing title" });
    }

    const creatorId = userId; // or if admin is creating for another user, parse it differently

    const insertRes = await pool.query(
      `INSERT INTO tasks (user_id, title, description, status, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, title, description, status, created_by, created_at`,
      [
        userId,
        title,
        description || null,
        status || "todo",
        creatorId
      ]
    );

    return res.json({
      message: "Task created",
      task: insertRes.rows[0]
    });
  } catch (err) {
    console.error("// create task error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/tasks/:id
 * update task's status or details
 * ex: { title, description, status }
 */
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const taskId = req.params.id;
    const { title, description, status } = req.body;

    // fetch task first
    const taskRes = await pool.query(
      "SELECT id, user_id, title, description, status FROM tasks WHERE id=$1",
      [taskId]
    );
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    const task = taskRes.rows[0];
    // check if the current user is the assignee or has permission
    if (task.user_id !== userId) {
      return res.status(403).json({ error: "Not your task" });
    }

    // build update query
    let updateQuery = `
      UPDATE tasks
      SET updated_at=NOW()
    `;
    const fields = [];
    const values = [];
    if (title !== undefined) {
      fields.push("title");
      values.push(title);
    }
    if (description !== undefined) {
      fields.push("description");
      values.push(description);
    }
    if (status !== undefined) {
      fields.push("status");
      values.push(status);
    }

    // if no fields are updated
    if (fields.length === 0) {
      return res.json({ message: "No changes" });
    }

    const setParts = fields.map((f, i) => `${f}=$${i+1}`);
    updateQuery += ", " + setParts.join(", ");
    updateQuery += " WHERE id=$" + (fields.length+1);
    updateQuery += " RETURNING id, user_id, title, description, status, created_by, created_at, updated_at";

    values.push(taskId);

    const updateRes = await pool.query(updateQuery, values);

    return res.json({
      message: "Task updated",
      task: updateRes.rows[0]
    });
  } catch (err) {
    console.error("// update task error", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
