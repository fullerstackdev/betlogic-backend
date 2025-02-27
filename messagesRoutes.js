require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const { requireAuth } = require("./authMiddleware");

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl: { rejectUnauthorized: false } if needed
});

/**
 * GET /api/messages/threads
 * Returns all threads where the user is a participant
 * plus optional last message or participant list if you want
 */
router.get("/threads", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;

    // we join thread_participants to threads
    const query = `
      SELECT t.id, t.title, t.created_at
      FROM thread_participants tp
      JOIN threads t ON tp.thread_id = t.id
      WHERE tp.user_id = $1
      ORDER BY t.created_at DESC
    `;
    const result = await pool.query(query, [userId]);

    // If you also want to fetch participants or last message, you can do so here,
    // but let's keep it simple.
    return res.json(result.rows);
  } catch (err) {
    console.error("// get threads error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/messages/threads
 * Creates a new thread with participants
 * expects { title, participantIds: [2,3, ...] }
 * automatically adds the current user if not in participantIds
 */
router.post("/threads", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { title, participantIds } = req.body;

    // create thread
    const threadRes = await pool.query(
      `INSERT INTO threads (title)
       VALUES ($1)
       RETURNING id, title, created_at`,
      [title || null]
    );
    const newThread = threadRes.rows[0];
    const threadId = newThread.id;

    // build a unique set of participants including the current user
    let uniqueIds = Array.isArray(participantIds) ? [...new Set(participantIds)] : [];
    if (!uniqueIds.includes(userId)) {
      uniqueIds.push(userId);
    }

    // insert into thread_participants
    for (const pid of uniqueIds) {
      await pool.query(
        `INSERT INTO thread_participants (thread_id, user_id)
         VALUES ($1, $2)`,
        [threadId, pid]
      );
    }

    return res.json({
      message: "Thread created",
      thread: newThread
    });
  } catch (err) {
    console.error("// create thread error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/messages/threads/:threadId
 * returns messages for that thread if user is a participant
 * optionally also returns the participant list
 */
router.get("/threads/:threadId", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const threadId = req.params.threadId;

    // check if user is in that thread
    const partCheck = await pool.query(
      `SELECT id FROM thread_participants
       WHERE thread_id=$1 AND user_id=$2`,
      [threadId, userId]
    );
    if (partCheck.rows.length === 0) {
      return res.status(403).json({ error: "Not a participant in this thread" });
    }

    // fetch messages
    const msgQuery = `
      SELECT m.id, m.thread_id, m.sender_id, m.content, m.created_at,
             u.email as sender_email
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.thread_id = $1
      ORDER BY m.created_at ASC
    `;
    const msgRes = await pool.query(msgQuery, [threadId]);

    // optional: fetch participants
    const partQuery = `
      SELECT tp.id, tp.user_id, tp.role, u.email as user_email
      FROM thread_participants tp
      JOIN users u ON tp.user_id = u.id
      WHERE tp.thread_id=$1
    `;
    const participantsRes = await pool.query(partQuery, [threadId]);

    return res.json({
      threadId: threadId,
      messages: msgRes.rows,
      participants: participantsRes.rows
    });
  } catch (err) {
    console.error("// get thread messages error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/messages/threads/:threadId
 * user posts a new message if they're a participant
 * expects { content }
 */
router.post("/threads/:threadId", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const threadId = req.params.threadId;
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Missing content" });
    }

    // check if user is a participant
    const partCheck = await pool.query(
      `SELECT id FROM thread_participants
       WHERE thread_id=$1 AND user_id=$2`,
      [threadId, userId]
    );
    if (partCheck.rows.length === 0) {
      return res.status(403).json({ error: "Not a participant in this thread" });
    }

    // insert message
    const insertRes = await pool.query(
      `INSERT INTO messages (thread_id, sender_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, thread_id, sender_id, content, created_at`,
      [threadId, userId, content]
    );

    return res.json({
      message: "Message posted",
      msg: insertRes.rows[0]
    });
  } catch (err) {
    console.error("// post message error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * (Optional) POST /api/messages/threads/:threadId/participants
 * add more participants to an existing thread
 * expects { userIds: [ ... ] }
 */
router.post("/threads/:threadId/participants", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const threadId = req.params.threadId;
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "Missing userIds array" });
    }

    // check if user is a participant (or if user is admin? your call)
    const partCheck = await pool.query(
      `SELECT id FROM thread_participants
       WHERE thread_id=$1 AND user_id=$2`,
      [threadId, userId]
    );
    if (partCheck.rows.length === 0) {
      return res.status(403).json({ error: "Not a participant in this thread" });
    }

    // insert new participants
    const uniqueIds = [...new Set(userIds)];
    for (const pid of uniqueIds) {
      // check if already in thread
      const existing = await pool.query(
        `SELECT id FROM thread_participants
         WHERE thread_id=$1 AND user_id=$2`,
        [threadId, pid]
      );
      if (existing.rows.length === 0) {
        await pool.query(
          `INSERT INTO thread_participants (thread_id, user_id)
           VALUES ($1, $2)`,
          [threadId, pid]
        );
      }
    }

    return res.json({ message: "Participants added" });
  } catch (err) {
    console.error("// add participants error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
