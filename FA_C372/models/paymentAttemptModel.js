const pool = require("./db");

const ensureTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      order_id INT NULL,
      provider VARCHAR(40) NOT NULL,
      method VARCHAR(40) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'INITIATED',
      amount DECIMAL(10,2) NULL,
      currency VARCHAR(10) NULL,
      ip_address VARCHAR(45) NULL,
      failure_reason VARCHAR(255) NULL,
      provider_order_id VARCHAR(120) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_pa_user_created (user_id, created_at),
      INDEX idx_pa_provider_order (provider_order_id),
      INDEX idx_pa_status (status)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_retries (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      attempt_id INT NULL,
      order_id INT NULL,
      provider VARCHAR(40) NOT NULL,
      provider_order_id VARCHAR(120) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      next_retry_at DATETIME NULL,
      retry_count INT NOT NULL DEFAULT 0,
      last_error VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_pr_status_next_retry (status, next_retry_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fraud_events (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      payment_id INT NULL,
      rule_code VARCHAR(60) NOT NULL,
      severity ENUM('low','medium','high') NOT NULL,
      details JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_fe_user_created (user_id, created_at)
    )
  `);
};

const createPaymentAttempt = async (data) => {
  const {
    userId,
    orderId = null,
    provider,
    method,
    status = "INITIATED",
    amount = null,
    currency = null,
    ipAddress = null,
    failureReason = null,
    providerOrderId = null,
  } = data || {};

  const [result] = await pool.query(
    `INSERT INTO payment_attempts
      (user_id, order_id, provider, method, status, amount, currency, ip_address, failure_reason, provider_order_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId || null,
      orderId || null,
      provider,
      method,
      status,
      amount,
      currency,
      ipAddress,
      failureReason,
      providerOrderId,
    ]
  );
  return result.insertId;
};

const updateAttemptStatusByProviderOrder = async (providerOrderId, status, failureReason = null) => {
  if (!providerOrderId) return;
  await pool.query(
    `UPDATE payment_attempts
     SET status = ?, failure_reason = ?
     WHERE provider_order_id = ?`,
    [status, failureReason, providerOrderId]
  );
};

const countRecentAttempts = async ({ userId, ipAddress, minutes = 10 }) => {
  const safeMinutes = Number(minutes) > 0 ? Number(minutes) : 10;
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS attempt_count
     FROM payment_attempts
     WHERE created_at >= (NOW() - INTERVAL ? MINUTE)
       AND (
         (user_id IS NOT NULL AND user_id = ?)
         OR (ip_address IS NOT NULL AND ip_address = ?)
       )`,
    [safeMinutes, userId || null, ipAddress || null]
  );
  return Number(rows[0]?.attempt_count || 0);
};

const countRecentFailures = async ({ userId, ipAddress, minutes = 10 }) => {
  const safeMinutes = Number(minutes) > 0 ? Number(minutes) : 10;
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS fail_count
     FROM payment_attempts
     WHERE created_at >= (NOW() - INTERVAL ? MINUTE)
       AND UPPER(status) = 'FAILED'
       AND (
         (user_id IS NOT NULL AND user_id = ?)
         OR (ip_address IS NOT NULL AND ip_address = ?)
       )`,
    [safeMinutes, userId || null, ipAddress || null]
  );
  return Number(rows[0]?.fail_count || 0);
};

const getFraudEventsSummary = async (hours = 24) => {
  const safeHours = Math.max(1, Math.min(Number(hours) || 24, 720));
  const [rows] = await pool.query(
    `SELECT severity, COUNT(*) AS total
     FROM fraud_events
     WHERE created_at >= (NOW() - INTERVAL ? HOUR)
     GROUP BY severity`,
    [safeHours]
  );
  const summary = { low: 0, medium: 0, high: 0, total: 0 };
  rows.forEach((row) => {
    const key = String(row.severity || "").toLowerCase();
    const count = Number(row.total || 0);
    if (summary[key] !== undefined) summary[key] = count;
    summary.total += count;
  });
  return summary;
};

const getRecentFraudEvents = async (limit = 30) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 200));
  const [rows] = await pool.query(
    `SELECT
       fe.id,
       fe.user_id,
       u.name AS user_name,
       u.email AS user_email,
       fe.rule_code,
       fe.severity,
       fe.details,
       fe.created_at
     FROM fraud_events fe
     LEFT JOIN users u ON u.id = fe.user_id
     ORDER BY fe.created_at DESC
     LIMIT ${safeLimit}`
  );
  return rows.map((row) => {
    let details = row.details;
    try {
      details = typeof row.details === "string" ? JSON.parse(row.details) : row.details;
    } catch {
      details = row.details;
    }
    return { ...row, details };
  });
};

module.exports = {
  ensureTables,
  createPaymentAttempt,
  updateAttemptStatusByProviderOrder,
  countRecentAttempts,
  countRecentFailures,
  getFraudEventsSummary,
  getRecentFraudEvents,
};
