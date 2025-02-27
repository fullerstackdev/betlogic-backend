require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const { requireAuth } = require("./authMiddleware");
// if you want requireAdmin or requireSuperadmin specifically, we'll incorporate that below

const router = express.Router();

// create pg pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl might be needed if Render requires it
  // ssl: { rejectUnauthorized: false },
});

/**
 * GET /api/tasks
 * - if user.role in ["admin","superadmin"], returns all tasks
 * - otherwise returns tasks assigned to req.user.userId
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const { userId, role } = req.user;

    let query = `
      SELECT id, user_id, title, description, status, created_by, created_at, updated_at
      FROM tasks
      ORDER BY id DESC
    `;
    let params = [];

    if (role !== "admin" && role !== "superadmin") {
      // normal user => filter tasks by user_id
      query = `
        SELECT id, user_id, title, description, status, created_by, created_at, updated_at
        FROM tasks
        WHERE user_id=$1
        ORDER BY id DESC
      `;
      params = [userId];
    }

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("// get tasks error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/tasks
 * - if normal user, forced to create tasks for themselves
 * - if admin/superadmin, can pass user_id in the body to assign tasks to that user
 */
router.post("/", requireAuth, async (req, res) => {
  try {
    const { userId, role } = req.user;
    const { user_id, title, description, status } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Missing title" });
    }

    let assignedUserId = userId; // default = the user themselves

    // if admin, they can override assignedUserId
    if ((role === "admin" || role === "superadmin") && user_id) {
      assignedUserId = user_id;
    }

    // insert
    const insertRes = await pool.query(
      `INSERT INTO tasks (user_id, title, description, status, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, title, description, status, created_by, created_at, updated_at`,
      [
        assignedUserId,
        title,
        description || null,
        status || "todo",
        userId  // created_by is the user who posted this route
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
 * - if normal user, can only update tasks assigned to themselves
 * - if admin/superadmin, can update any task
 */
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const { userId, role } = req.user;
    const taskId = req.params.id;
    const { title, description, status } = req.body;

    // fetch the task
    const taskRes = await pool.query(
      `SELECT id, user_id, title, description, status, created_by
       FROM tasks
       WHERE id=$1`,
      [taskId]
    );
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    const task = taskRes.rows[0];

    // check ownership
    if (role !== "admin" && role !== "superadmin") {
      // normal user => must be their task
      if (task.user_id !== userId) {
        return res.status(403).json({ error: "Not your task" });
      }
    }
    // if admin or superadmin, they can update any user's tasks

    // build partial update
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

    if (fields.length === 0) {
      return res.json({ message: "No changes" });
    }

    let updateQuery = "UPDATE tasks SET updated_at=NOW()";
    const setParts = fields.map((f, i) => `, ${f}=$${i+1}`);
    updateQuery += setParts.join("");
    updateQuery += ` WHERE id=$${fields.length+1}`;
    updateQuery += ` RETURNING id, user_id, title, description, status, created_by, created_at, updated_at`;

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
