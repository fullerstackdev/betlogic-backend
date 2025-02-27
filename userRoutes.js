require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const { requireAuth } = require("./authMiddleware"); // same folder as authMiddleware

const router = express.Router();

// create PG pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl if needed:
  // ssl: { rejectUnauthorized: false },
});

/**
 * GET /api/users/me
 * Returns the currently logged-in user's data in the final shape needed by your front end.
 */
router.get("/me", requireAuth, async (req, res) => {
  try {
    // req.user was set by your JWT logic: { userId, role, ... }
    const userId = req.user.userId;
    const query = `
      SELECT 
        id, 
        email,
        first_name,
        last_name,
        phone,
        address,
        role,
        status,
        created_at,
        updated_at
      FROM users
      WHERE id=$1
    `;
    const result = await pool.query(query, [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    // Return the single user object
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("// GET /api/users/me error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/users/me
 * Expects some combination of { first_name, last_name, phone, address } in the body.
 * Allows the user to update their own profile info.
 */
router.patch("/me", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { first_name, last_name, phone, address } = req.body;

    // We'll only update the fields that are provided (not undefined).
    // Building a partial UPDATE dynamically:
    const fields = [];
    const values = [];
    let baseQuery = "UPDATE users SET updated_at=NOW()";

    if (typeof first_name === "string") {
      fields.push(`first_name=$${fields.length + 1}`);
      values.push(first_name);
    }
    if (typeof last_name === "string") {
      fields.push(`last_name=$${fields.length + 1}`);
      values.push(last_name);
    }
    if (typeof phone === "string") {
      fields.push(`phone=$${fields.length + 1}`);
      values.push(phone);
    }
    if (typeof address === "string") {
      fields.push(`address=$${fields.length + 1}`);
      values.push(address);
    }

    // If no fields to update, return the existing row as is
    if (fields.length === 0) {
      // fetch the user to return the current data
      const existingRes = await pool.query(
        `SELECT 
          id,
          email,
          first_name,
          last_name,
          phone,
          address,
          role,
          status,
          created_at,
          updated_at
         FROM users
         WHERE id=$1`,
        [userId]
      );
      if (existingRes.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }
      return res.json(existingRes.rows[0]);
    }

    // build final query
    baseQuery += ", " + fields.join(", ");
    // e.g. "UPDATE users SET updated_at=NOW(), first_name=$1, phone=$2"
    baseQuery += ` WHERE id=$${fields.length + 1} RETURNING 
      id,
      email,
      first_name,
      last_name,
      phone,
      address,
      role,
      status,
      created_at,
      updated_at
    `;
    // add userId to the values
    values.push(userId);

    const updateRes = await pool.query(baseQuery, values);
    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    // Return the updated user
    return res.json(updateRes.rows[0]);
  } catch (err) {
    console.error("// PATCH /api/users/me error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
