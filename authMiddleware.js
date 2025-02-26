require("dotenv").config();
const jwt = require("jsonwebtoken");

// Checks for Authorization: Bearer token, verifies it, sets req.user
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "No token provided" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Invalid token format" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("<// JWT verification error >", err);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Allows if req.user.role is "admin" or "superadmin"
function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "superadmin")) {
    return res.status(403).json({ error: "Forbidden: Admins only" });
  }
  next();
}

// Only allows if req.user.role is "superadmin"
function requireSuperadmin(req, res, next) {
  if (!req.user || req.user.role !== "superadmin") {
    return res.status(403).json({ error: "Forbidden: Superadmin only" });
  }
  next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireSuperadmin,
};
