require("dotenv").config();
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const router = express.Router();

// create pg pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // if your Render DB needs SSL, uncomment the next line:
  // ssl: { rejectUnauthorized: false },
});

// nodemailer transporter (gmail example)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// generate JWT
function generateToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1d" });
}

// send verification email
async function sendVerificationEmail(toEmail, token) {
  const verifyURL = `${process.env.SERVER_URL}/api/auth/verify/${token}`;
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: toEmail,
    subject: "BetLogic - Verify Your Account",
    text: `Please verify your account by clicking: ${verifyURL}`,
  };
  await transporter.sendMail(mailOptions);
}

// utility: send forgot/reset email
async function sendResetEmail(toEmail, resetToken) {
  const resetURL = `${process.env.SERVER_URL}/auth/reset?token=${resetToken}`;
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: toEmail,
    subject: "BetLogic - Reset Your Password",
    text: `Click here to reset your password: ${resetURL}`,
  };
  await transporter.sendMail(mailOptions);
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }
    // check if user exists
    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "User already exists" });
    }
    // hash password
    const hashed = await bcrypt.hash(password, 10);
    // generate verification token
    const verificationToken = crypto.randomBytes(20).toString("hex");
    // insert user
    const insertRes = await pool.query(
      `INSERT INTO users
       (email, password_hash, first_name, last_name, role, status, verification_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, role, status`,
      [
        email,
        hashed,
        firstName || null,
        lastName || null,
        "user",
        "pendingVerification",
        verificationToken,
      ]
    );
    const newUser = insertRes.rows[0];
    // send verification email
    await sendVerificationEmail(email, verificationToken);
    return res.json({
      message: "User registered. Check your email for verification link.",
      user: newUser,
    });
  } catch (err) {
    console.error("// register error", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/auth/verify/:token
router.get("/verify/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const userRes = await pool.query(
      "SELECT id, status FROM users WHERE verification_token=$1",
      [token]
    );
    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }
    const user = userRes.rows[0];
    if (user.status === "active") {
      return res.json({ message: "Account already verified." });
    }
    // mark user active
    await pool.query(
      `UPDATE users
       SET status='active', verification_token=NULL
       WHERE id=$1`,
      [user.id]
    );
    return res.json({ message: "Email verified successfully. You can now log in." });
  } catch (err) {
    console.error("// verify error", err);
    res.status(500).json({ error: "Server error" });
  }
});

/// POST /api/auth/login (Updated)
router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Missing email or password" });
      }
  
      const userRes = await pool.query(
        `SELECT id, email, password_hash, role, status, first_name, last_name, onboarding_completed
         FROM users WHERE email=$1`,
        [email]
      );
  
      if (userRes.rows.length === 0) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
  
      const user = userRes.rows[0];
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
  
      if (user.status !== "active") {
        return res.status(403).json({ error: "Please verify your email first." });
      }
  
      const token = generateToken({ userId: user.id, role: user.role });
  
      return res.json({
        message: "Login successful",
        token,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        onboardingCompleted: user.onboarding_completed,
      });
    } catch (err) {
      console.error("// login error", err);
      res.status(500).json({ error: "Server error" });
    }
  });
  

// POST /api/auth/forgot
router.post("/forgot", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Missing email" });
    }
    // find user
    const userRes = await pool.query(
      "SELECT id, email, status FROM users WHERE email=$1",
      [email]
    );
    // for security, do not reveal if user doesn't exist
    if (userRes.rows.length === 0) {
      return res.json({ message: "If that email exists, reset link sent." });
    }
    const user = userRes.rows[0];
    // generate reset token
    const resetToken = crypto.randomBytes(20).toString("hex");
    // store in DB
    await pool.query(
      "UPDATE users SET reset_token=$1 WHERE id=$2",
      [resetToken, user.id]
    );
    // send reset email
    await sendResetEmail(email, resetToken);
    return res.json({ message: "If that email exists, reset link sent." });
  } catch (err) {
    console.error("// forgot error", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/auth/reset
router.post("/reset", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: "Missing token or newPassword" });
    }
    // find user by reset_token
    const userRes = await pool.query(
      "SELECT id FROM users WHERE reset_token=$1",
      [token]
    );
    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: "Invalid reset token" });
    }
    const user = userRes.rows[0];
    // hash new password
    const hashed = await bcrypt.hash(newPassword, 10);
    // update user
    await pool.query(
      "UPDATE users SET password_hash=$1, reset_token=NULL WHERE id=$2",
      [hashed, user.id]
    );
    return res.json({ message: "Password reset successful. You can now log in." });
  } catch (err) {
    console.error("// reset error", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
