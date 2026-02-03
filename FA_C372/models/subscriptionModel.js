const pool = require("./db");

const ensureTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      plan_code VARCHAR(30) NOT NULL,
      plan_name VARCHAR(60) NOT NULL,
      monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      status ENUM('active','pending_contact','cancelled') NOT NULL DEFAULT 'active',
      starts_at DATETIME NOT NULL,
      ends_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_subscription_user (user_id),
      CONSTRAINT fk_subscription_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
};

const getSubscriptionByUser = async (userId) => {
  const [rows] = await pool.query(
    `SELECT id, user_id, plan_code, plan_name, monthly_price, status, starts_at, ends_at, updated_at
     FROM subscriptions
     WHERE user_id = ?
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
};

const upsertSubscription = async ({
  userId,
  planCode,
  planName,
  monthlyPrice,
  status = "active",
  startsAt = new Date(),
}) => {
  await pool.query(
    `INSERT INTO subscriptions (user_id, plan_code, plan_name, monthly_price, status, starts_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       plan_code = VALUES(plan_code),
       plan_name = VALUES(plan_name),
       monthly_price = VALUES(monthly_price),
       status = VALUES(status),
       starts_at = VALUES(starts_at),
       ends_at = NULL`,
    [userId, planCode, planName, monthlyPrice, status, startsAt]
  );
};

module.exports = {
  ensureTable,
  getSubscriptionByUser,
  upsertSubscription,
};
