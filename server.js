require("dotenv").config();
console.log("DEBUG DATABASE_URL =", process.env.DATABASE_URL);
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const authRoutes = require("./authRoutes");
const adminRoutes = require("./adminRoutes"); 
const financesRoutes = require("./financesRoutes");
const promotionsRoutes = require("./promotionsRoutes");
const tasksRoutes = require("./tasksRoutes");
const betsRoutes = require("./betsRoutes");
const calendarRoutes = require("./calendarRoutes");
const messagesRoutes = require("./messagesRoutes");
const notificationsRoutes = require("./notificationsRoutes");


const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/finances", financesRoutes);
app.use("/api/promotions", promotionsRoutes);
app.use("/api/tasks", tasksRoutes);
app.use("/api/bets", betsRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/notifications", notificationsRoutes);


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
      console.error("DEBUG PING ERROR:", err);
      res.status(500).json({ error: "Database connection failed" });
    }
  });

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
