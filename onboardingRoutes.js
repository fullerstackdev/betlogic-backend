const express = require("express");
const router = express.Router();
const { Pool } = require("pg");
const { authenticateJWT } = require("./authMiddleware");


// Setup connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Middleware for JWT Auth (existing middleware)
const { authenticateJWT } = require("./authMiddleware");

// POST /api/onboarding
router.post("/", authenticateJWT, async (req, res) => {
  const userId = req.user.userId; // from JWT middleware
  const {
    birthday,
    has_paypal,
    primary_bank,
    used_sportsbooks,
    sportsbooks_used,
    calendar_availability,
    completed_promotions,
  } = req.body;

  try {
    // Insert onboarding data into database
    await pool.query(
      `INSERT INTO user_onboarding (
        user_id, birthday, has_paypal, primary_bank, used_sportsbooks, sportsbooks_used, calendar_availability, completed_promotions
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        userId,
        birthday,
        has_paypal,
        primary_bank,
        used_sportsbooks,
        sportsbooks_used,
        calendar_availability,
        completed_promotions,
      ]
    );

    res.status(201).json({ message: "Onboarding completed successfully." });
  } catch (err) {
    console.error("Error in onboarding:", err);
    res.status(500).json({ error: "Server error during onboarding." });
  }
});

module.exports = router;
