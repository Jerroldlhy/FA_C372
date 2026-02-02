const pool = require("./db");

const upsertProgress = async ({ user_id, course_id, progress_percent, status }) => {
  await pool.query(
    `INSERT INTO course_progress (user_id, course_id, progress_percent, status)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       progress_percent = VALUES(progress_percent),
       status = VALUES(status),
       updated_at = CURRENT_TIMESTAMP`,
    [user_id, course_id, progress_percent, status || "in_progress"]
  );
};

const getProgress = async ({ user_id, course_id }) => {
  const [rows] = await pool.query(
    `SELECT progress_id, user_id, course_id, progress_percent, status, updated_at
     FROM course_progress
     WHERE user_id = ? AND course_id = ?
     LIMIT 1`,
    [user_id, course_id]
  );
  return rows[0] || null;
};

const listProgressByUser = async (userId) => {
  const [rows] = await pool.query(
    `SELECT cp.progress_id, cp.course_id, c.course_name, cp.progress_percent, cp.status, cp.updated_at
     FROM course_progress cp
     INNER JOIN courses c ON cp.course_id = c.course_id
     WHERE cp.user_id = ?
     ORDER BY cp.updated_at DESC`,
    [userId]
  );
  return rows;
};

module.exports = {
  upsertProgress,
  getProgress,
  listProgressByUser,
};
