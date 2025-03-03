const express = require("express");
const router = express.Router();
const { Pool } = require("pg");
const { requireAuth } = require("./authMiddleware");  // Explicit destructuring

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      birthday,
      has_paypal,
      primary_bank,
      used_sportsbooks,
      sportsbooks_used,
      calendar_availability,
      completed_promotions,
      referral_name,
    } = req.body;

    await pool.query(`
      INSERT INTO user_onboarding (
        user_id, birthday, has_paypal, primary_bank, used_sportsbooks,
        sportsbooks_used, calendar_availability, completed_promotions, referral_name
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      userId,
      birthday,
      has_paypal,
      primary_bank,
      used_sportsbooks,
      sportsbooks_used,
      calendar_availability,
      completed_promotions,
      referral_name,
    ]);

    await pool.query(
      "UPDATE users SET onboarding_completed=true WHERE id=$1",
      [userId]
    );

    res.status(200).json({ message: "Onboarding complete" });
  } catch (err) {
    console.error("Onboarding error:", err);
    res.status(500).json({ error: "Server error during onboarding" });
  }
});

module.exports = router;
