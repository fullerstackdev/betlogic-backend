require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const { requireAuth, requireAdmin } = require("./authMiddleware");
// or "./authMiddleware.js" if needed

const router = express.Router();

// create pg pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl might be needed if Render requires it
  // ssl: { rejectUnauthorized: false },
});

/**
 * GET /api/promotions
 * returns all active promotions
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const query = `
      SELECT id, title, description, image_url, status, start_date, end_date
      FROM promotions
      WHERE status <> 'archived'
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    return res.json(result.rows);
  } catch (err) {
    console.error("// get promotions error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/promotions/:id
 * returns detail for one promotion plus its steps
 */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const promoId = req.params.id;
    // fetch promotion
    const promoRes = await pool.query(
      "SELECT id, title, description, image_url, status, start_date, end_date FROM promotions WHERE id=$1",
      [promoId]
    );
    if (promoRes.rows.length === 0) {
      return res.status(404).json({ error: "Promotion not found" });
    }
    const promotion = promoRes.rows[0];

    // fetch steps
    const stepsRes = await pool.query(
      `SELECT id, promotion_id, step_number, title, description
       FROM promotion_steps
       WHERE promotion_id=$1
       ORDER BY step_number`,
      [promoId]
    );

    return res.json({
      promotion,
      steps: stepsRes.rows,
    });
  } catch (err) {
    console.error("// get promotion detail error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/promotions
 * admin-only route to create a new promotion + optional steps
 * expects: { title, description, imageUrl, startDate, endDate, steps:[{step_number, title, description}...] }
 */
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, description, imageUrl, startDate, endDate, steps } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Missing title" });
    }

    // insert promotion
    const promoRes = await pool.query(
      `INSERT INTO promotions
         (title, description, image_url, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, description, image_url, start_date, end_date, status`,
      [
        title,
        description || null,
        imageUrl || null,
        startDate || null,
        endDate || null
      ]
    );
    const newPromo = promoRes.rows[0];
    const promoId = newPromo.id;

    // if steps array is provided
    if (Array.isArray(steps) && steps.length > 0) {
      for (const s of steps) {
        const { step_number, title: stitle, description: sdesc } = s;
        await pool.query(
          `INSERT INTO promotion_steps
             (promotion_id, step_number, title, description)
           VALUES ($1, $2, $3, $4)`,
          [promoId, step_number, stitle || null, sdesc || null]
        );
      }
    }

    return res.json({
      message: "Promotion created",
      promotion: newPromo
    });
  } catch (err) {
    console.error("// create promotion error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/promotions/:id/progress
 * user updates their progress for a promotion
 * expects { completedSteps: [...], progressPct: number }
 */
router.post("/:id/progress", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const promoId = req.params.id;
    const { completedSteps, progressPct } = req.body;

    // check if user_promotion_progress row exists
    const uppRes = await pool.query(
      "SELECT id, completed_steps, progress_pct FROM user_promotion_progress WHERE user_id=$1 AND promotion_id=$2",
      [userId, promoId]
    );
    if (uppRes.rows.length === 0) {
      // insert new row
      const insertRes = await pool.query(
        `INSERT INTO user_promotion_progress
           (user_id, promotion_id, completed_steps, progress_pct, started_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id, user_id, promotion_id, completed_steps, progress_pct`,
        [
          userId,
          promoId,
          JSON.stringify(completedSteps || []),
          progressPct || 0
        ]
      );
      return res.json({
        message: "Progress created",
        progress: insertRes.rows[0]
      });
    } else {
      // update row
      const existing = uppRes.rows[0];
      const newSteps = completedSteps ? JSON.stringify(completedSteps) : existing.completed_steps;
      const newPct = (typeof progressPct === "number") ? progressPct : existing.progress_pct;

      // if newPct = 100 => completed_at = now
      let completedAtClause = "";
      if (newPct === 100) {
        completedAtClause = ", completed_at=NOW()";
      }

      const updateRes = await pool.query(
        `UPDATE user_promotion_progress
         SET completed_steps=$1,
             progress_pct=$2,
             updated_at=NOW()
             ${completedAtClause}
         WHERE id=$3
         RETURNING id, user_id, promotion_id, completed_steps, progress_pct, started_at, completed_at`,
        [newSteps, newPct, existing.id]
      );
      return res.json({
        message: "Progress updated",
        progress: updateRes.rows[0]
      });
    }
  } catch (err) {
    console.error("// update progress error", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
