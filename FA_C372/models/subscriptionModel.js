const pool = require("./db");

const ensureColumn = async (tableName, columnName, definitionSql) => {
  const [rows] = await pool.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  if (rows.length) return;
  await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`);
};

const ensureIndex = async (tableName, indexName, createSql) => {
  const [rows] = await pool.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  if (rows.length) return;
  await pool.query(createSql);
};

const ensureTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      plan_code VARCHAR(30) NOT NULL,
      plan_name VARCHAR(60) NOT NULL,
      monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      status ENUM('active','pending_contact','cancelled') NOT NULL DEFAULT 'active',
      stripe_customer_id VARCHAR(100) NULL,
      stripe_subscription_id VARCHAR(100) NULL,
      starts_at DATETIME NOT NULL,
      ends_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_subscription_user (user_id),
      UNIQUE KEY uniq_subscription_stripe_sub (stripe_subscription_id),
      CONSTRAINT fk_subscription_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await ensureColumn("subscriptions", "stripe_customer_id", "VARCHAR(100) NULL");
  await ensureColumn("subscriptions", "stripe_subscription_id", "VARCHAR(100) NULL");
  await ensureIndex(
    "subscriptions",
    "uniq_subscription_stripe_sub",
    "CREATE UNIQUE INDEX uniq_subscription_stripe_sub ON subscriptions (stripe_subscription_id)"
  );
};

const getSubscriptionByUser = async (userId) => {
  const [rows] = await pool.query(
    `SELECT id, user_id, plan_code, plan_name, monthly_price, status, stripe_customer_id, stripe_subscription_id, starts_at, ends_at, updated_at
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
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  startsAt = new Date(),
}) => {
  await pool.query(
    `INSERT INTO subscriptions (user_id, plan_code, plan_name, monthly_price, status, stripe_customer_id, stripe_subscription_id, starts_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       plan_code = VALUES(plan_code),
       plan_name = VALUES(plan_name),
       monthly_price = VALUES(monthly_price),
       status = VALUES(status),
       stripe_customer_id = VALUES(stripe_customer_id),
       stripe_subscription_id = VALUES(stripe_subscription_id),
       starts_at = VALUES(starts_at),
       ends_at = NULL`,
    [userId, planCode, planName, monthlyPrice, status, stripeCustomerId, stripeSubscriptionId, startsAt]
  );
};

const updateSubscriptionByStripeId = async ({
  stripeSubscriptionId,
  planCode,
  planName,
  monthlyPrice,
  status,
  endsAt = null,
}) => {
  const [result] = await pool.query(
    `UPDATE subscriptions
     SET plan_code = ?,
         plan_name = ?,
         monthly_price = ?,
         status = ?,
         ends_at = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE stripe_subscription_id = ?`,
    [planCode, planName, monthlyPrice, status, endsAt, stripeSubscriptionId]
  );
  return Number(result.affectedRows || 0) > 0;
};

const cancelSubscriptionByUser = async (userId, endsAt = new Date()) => {
  const [result] = await pool.query(
    `UPDATE subscriptions
     SET status = 'cancelled',
         ends_at = ?
     WHERE user_id = ?
       AND status <> 'cancelled'`,
    [endsAt, userId]
  );
  return Number(result.affectedRows || 0) > 0;
};

module.exports = {
  ensureTable,
  getSubscriptionByUser,
  upsertSubscription,
  updateSubscriptionByStripeId,
  cancelSubscriptionByUser,
};
