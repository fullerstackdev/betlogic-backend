const express = require("express");
const { Pool } = require("pg");
const { requireAuth, requireSuperadmin } = require("./authMiddleware"); 
// adjust path if your authMiddleware is in a different folder

const router = express.Router();

// create pg pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl might be needed if your DB requires it
  // ssl: { rejectUnauthorized: false },
});

/**
 * POST /api/admin/promote
 * Body: { userId, newRole }
 * Only superadmin can do this
 */
router.post("/promote", requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const { userId, newRole } = req.body;
    if (!userId || !newRole) {
      return res.status(400).json({ error: "Missing userId or newRole" });
    }
    // update user
    const updateRes = await pool.query(
      "UPDATE users SET role=$1 WHERE id=$2 RETURNING id, email, role",
      [newRole, userId]
    );
    if (updateRes.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const updatedUser = updateRes.rows[0];
    return res.json({
      message: "User role updated",
      user: updatedUser,
    });
  } catch (err) {
    console.error("// promote error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * Example test route: /api/admin/test
 * Only admin or superadmin can call, but let's keep it superadmin for demonstration.
 * If you want admin to have access, use requireAdmin
 */
router.get("/test", requireAuth, requireSuperadmin, (req, res) => {
  return res.json({
    message: "You are superadmin, welcome to the admin test route"
  });
});

module.exports = router;
