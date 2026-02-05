const pool = require("../db");

const ensureTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_activity_logs (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      actor_user_id INT NULL,
      activity_type VARCHAR(40) NOT NULL,
      ip_address VARCHAR(45) NULL,
      details JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_activity_user_created (user_id, created_at),
      CONSTRAINT fk_user_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_activity_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
};

const logUserActivity = async ({
  userId,
  activityType,
  actorUserId = null,
  ipAddress = null,
  details = null,
}) => {
  if (!userId || !activityType) return;
  await pool.query(
    `INSERT INTO user_activity_logs (user_id, actor_user_id, activity_type, ip_address, details)
     VALUES (?, ?, ?, ?, ?)`,
    [
      userId,
      actorUserId || null,
      String(activityType).slice(0, 40),
      ipAddress ? String(ipAddress).slice(0, 45) : null,
      details ? JSON.stringify(details) : null,
    ]
  );
};

const getUserActivities = async (userId, limit = 50) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const [rows] = await pool.query(
    `SELECT id, user_id, actor_user_id, activity_type, ip_address, details, created_at
     FROM user_activity_logs
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ${safeLimit}`,
    [userId]
  );
  return rows;
};

const getRecentActivities = async (limit = 20) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
  const [rows] = await pool.query(
    `SELECT
       l.id,
       l.user_id,
       l.actor_user_id,
       l.activity_type,
       l.ip_address,
       l.details,
       l.created_at,
       u.name AS user_name,
       a.name AS actor_name
     FROM user_activity_logs l
     LEFT JOIN users u ON u.id = l.user_id
     LEFT JOIN users a ON a.id = l.actor_user_id
     ORDER BY l.created_at DESC
     LIMIT ${safeLimit}`
  );
  return rows;
};

const getDistinctActivityTypes = async () => {
  const [rows] = await pool.query(
    `SELECT DISTINCT activity_type
     FROM user_activity_logs
     ORDER BY activity_type ASC`
  );
  return rows.map((row) => String(row.activity_type || "").trim()).filter(Boolean);
};

const getAuditLogRows = async ({ fromDate = "", toDate = "", activityType = "", userId = null, actorUserId = null } = {}) => {
  const where = [];
  const params = [];

  if (String(fromDate || "").trim()) {
    where.push("l.created_at >= ?");
    params.push(String(fromDate).trim());
  }
  if (String(toDate || "").trim()) {
    where.push("l.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(String(toDate).trim());
  }
  if (String(activityType || "").trim()) {
    where.push("l.activity_type = ?");
    params.push(String(activityType).trim());
  }
  if (Number(userId) > 0) {
    where.push("l.user_id = ?");
    params.push(Number(userId));
  }
  if (Number(actorUserId) > 0) {
    where.push("l.actor_user_id = ?");
    params.push(Number(actorUserId));
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `SELECT
       l.id,
       l.user_id,
       l.actor_user_id,
       l.activity_type,
       l.ip_address,
       l.details,
       l.created_at,
       u.name AS user_name,
       u.email AS user_email,
       a.name AS actor_name,
       a.email AS actor_email
     FROM user_activity_logs l
     LEFT JOIN users u ON u.id = l.user_id
     LEFT JOIN users a ON a.id = l.actor_user_id
     ${whereSql}
     ORDER BY l.created_at DESC, l.id DESC`
    ,
    params
  );
  return rows;
};

module.exports = {
  ensureTable,
  logUserActivity,
  getUserActivities,
  getRecentActivities,
  getDistinctActivityTypes,
  getAuditLogRows,
};
