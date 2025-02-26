require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const { requireAuth, requireAdmin } = require("./authMiddleware");
// adjust path if your authMiddleware is in a subfolder

const router = express.Router();

// create pg pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // if needed for Render SSL:
  // ssl: { rejectUnauthorized: false },
});

/**
 * Helper to create a sportsbook account if user doesn't have it yet.
 * Called when user completes step 1 of a promotion.
 */
async function autoCreateSportsbookAccount(userId, accountName) {
  // check if user already has that account
  const checkRes = await pool.query(
    "SELECT id FROM accounts WHERE user_id=$1 AND name=$2",
    [userId, accountName]
  );
  if (checkRes.rows.length === 0) {
    // insert
    await pool.query(
      "INSERT INTO accounts (user_id, name) VALUES ($1, $2)",
      [userId, accountName]
    );
  }
}

/**
 * GET /api/promotions
 * returns promotions assigned to the current user from user_promotions_assigned table
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    // only return promotions assigned to this user
    const query = `
      SELECT p.id, p.title, p.description, p.image_url, p.status, p.start_date, p.end_date, p.sportsbook_name
      FROM user_promotions_assigned up
      JOIN promotions p ON up.promotion_id = p.id
      WHERE up.user_id = $1
      AND p.status <> 'archived'
      ORDER BY p.created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return res.json(result.rows);
  } catch (err) {
    console.error("// get user assigned promotions error", err);
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

    // check if user is assigned to this promotion
    const assignCheck = await pool.query(
      `SELECT id FROM user_promotions_assigned
       WHERE user_id=$1 AND promotion_id=$2`,
      [req.user.userId, promoId]
    );
    if (assignCheck.rows.length === 0) {
      return res.status(403).json({ error: "You are not assigned this promotion" });
    }

    // fetch promotion
    const promoRes = await pool.query(
      "SELECT id, title, description, image_url, status, start_date, end_date, sportsbook_name FROM promotions WHERE id=$1",
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
 * expects: {
 *   title, description, imageUrl, startDate, endDate, sportsbookName,
 *   steps:[{step_number, title, description}...]
 * }
 */
router.post("/", requireAuth, requireAdmin, async (req, res) => {
    try {
      const {
        title,
        description,
        imageUrl,
        startDate,
        endDate,
        sportsbook_name, // changed from sportsbookName to match JSON key
        steps
      } = req.body;
  
      if (!title) {
        return res.status(400).json({ error: "Missing title" });
      }
  
      // insert promotion, including sportsbook_name
      const promoRes = await pool.query(
        `INSERT INTO promotions
           (title, description, image_url, start_date, end_date, sportsbook_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, title, description, image_url, start_date, end_date, status, sportsbook_name`,
        [
          title,
          description || null,
          imageUrl || null,
          startDate || null,
          endDate || null,
          sportsbook_name || null
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
 * expects { completedSteps: [...] }
 * automatically calculates progressPct, creates an account if step 1 is completed
 */
router.post("/:id/progress", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const promoId = req.params.id;
    const { completedSteps } = req.body;

    // check assignment
    const assignCheck = await pool.query(
      `SELECT id FROM user_promotions_assigned
       WHERE user_id=$1 AND promotion_id=$2`,
      [userId, promoId]
    );
    if (assignCheck.rows.length === 0) {
      return res.status(403).json({ error: "You are not assigned this promotion" });
    }

    // fetch total steps
    const countRes = await pool.query(
      "SELECT COUNT(*) as total FROM promotion_steps WHERE promotion_id=$1",
      [promoId]
    );
    const totalSteps = parseInt(countRes.rows[0].total, 10) || 0;

    // unique completed steps
    const uniqueCompleted = Array.isArray(completedSteps)
      ? [...new Set(completedSteps)]
      : [];

    // compute newPct
    let newPct = 0;
    if (totalSteps > 0) {
      newPct = Math.floor((uniqueCompleted.length / totalSteps) * 100);
    }

    // fetch the promotion row to see if there's a sportsbook_name
    const promoRes = await pool.query(
      "SELECT id, sportsbook_name FROM promotions WHERE id=$1",
      [promoId]
    );
    if (promoRes.rows.length === 0) {
      return res.status(404).json({ error: "Promotion not found" });
    }
    const { sportsbook_name } = promoRes.rows[0];

    // if step 1 is in uniqueCompleted, and there's a sportsbook_name, create account
    if (uniqueCompleted.includes(1) && sportsbook_name) {
      await autoCreateSportsbookAccount(userId, sportsbook_name);
    }

    // check if user_promotion_progress row exists
    const uppRes = await pool.query(
      "SELECT id, completed_steps, progress_pct FROM user_promotion_progress WHERE user_id=$1 AND promotion_id=$2",
      [userId, promoId]
    );
    if (uppRes.rows.length === 0) {
      // insert
      const insertRes = await pool.query(
        `INSERT INTO user_promotion_progress
           (user_id, promotion_id, completed_steps, progress_pct, started_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id, user_id, promotion_id, completed_steps, progress_pct, started_at, completed_at`,
        [
          userId,
          promoId,
          JSON.stringify(uniqueCompleted),
          newPct
        ]
      );
      return res.json({
        message: "Progress created",
        progress: insertRes.rows[0]
      });
    } else {
      // update
      const existing = uppRes.rows[0];
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
        [JSON.stringify(uniqueCompleted), newPct, existing.id]
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

/**
 * POST /api/promotions/assign
 * Body: { userId, promotionId }
 * admin-only. assigns a promotion to a user in user_promotions_assigned
 */
router.post("/assign", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, promotionId } = req.body;
    if (!userId || !promotionId) {
      return res.status(400).json({ error: "Missing userId or promotionId" });
    }
    await pool.query(
      `INSERT INTO user_promotions_assigned (user_id, promotion_id)
       VALUES ($1, $2)`,
      [userId, promotionId]
    );
    return res.json({ message: "Promotion assigned to user" });
  } catch (err) {
    console.error("// assign promo error", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
