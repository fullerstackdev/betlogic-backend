require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// Create a pool to connect to the PostgreSQL database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Simple test endpoint
app.get("/api/ping", async (req, res) => {
  try {
    const pingRes = await pool.query("SELECT NOW() as current_time");
    res.json({ message: "pong", currentTime: pingRes.rows[0].current_time });
  } catch (err) {
    res.status(500).json({ error: "Database connection failed" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
