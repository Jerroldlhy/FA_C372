const pool = require("../db");

const columnExists = async (tableName, columnName) => {
  const [rows] = await pool.query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
};

const indexExists = async (tableName, indexName) => {
  const [rows] = await pool.query(
    `SELECT 1
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
};

const ensureAccountStatusColumns = async () => {
  if (!(await columnExists("users", "account_status"))) {
    await pool.query(
      "ALTER TABLE users ADD COLUMN account_status ENUM('active','suspended') NOT NULL DEFAULT 'active'"
    );
  }
  if (!(await columnExists("users", "suspended_at"))) {
    await pool.query(
      "ALTER TABLE users ADD COLUMN suspended_at DATETIME NULL"
    );
  }
};

const ensurePasswordResetColumns = async () => {
  if (!(await columnExists("users", "password_reset_token"))) {
    await pool.query(
      "ALTER TABLE users ADD COLUMN password_reset_token VARCHAR(128) NULL"
    );
  }
  if (!(await columnExists("users", "password_reset_expires_at"))) {
    await pool.query(
      "ALTER TABLE users ADD COLUMN password_reset_expires_at DATETIME NULL"
    );
  }
  if (!(await indexExists("users", "idx_users_password_reset_token"))) {
    await pool.query(
      "CREATE INDEX idx_users_password_reset_token ON users (password_reset_token)"
    );
  }
};

const ensureTwoFactorColumns = async () => {
  if (!(await columnExists("users", "twofactor_secret"))) {
    await pool.query(
      "ALTER TABLE users ADD COLUMN twofactor_secret VARCHAR(255) NULL"
    );
  }
  if (!(await columnExists("users", "is_2fa_enabled"))) {
    await pool.query(
      "ALTER TABLE users ADD COLUMN is_2fa_enabled TINYINT(1) NOT NULL DEFAULT 0"
    );
  }
};

const getUserByEmail = async (email) => {
  const [rows] = await pool.query(
    `SELECT id, name, email, password_hash, role, email_verified,
            COALESCE(account_status, 'active') AS account_status, suspended_at,
            COALESCE(is_2fa_enabled, 0) AS is_2fa_enabled, twofactor_secret
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email]
  );
  return rows[0] || null;
};

const getUserById = async (userId) => {
  const [rows] = await pool.query(
    `SELECT id, name, email, role,
            COALESCE(account_status, 'active') AS account_status, suspended_at,
            COALESCE(is_2fa_enabled, 0) AS is_2fa_enabled
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
};

const getUserWithTwoFactorById = async (userId) => {
  const [rows] = await pool.query(
    `SELECT id, name, email, role,
            COALESCE(account_status, 'active') AS account_status, suspended_at,
            COALESCE(is_2fa_enabled, 0) AS is_2fa_enabled,
            twofactor_secret
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
};

const createUser = async (name, email, passwordHash, role, verificationToken) => {
  const [result] = await pool.query(
    "INSERT INTO users (name, email, password_hash, role, verification_token) VALUES (?, ?, ?, ?, ?)",
    [name, email, passwordHash, role, verificationToken]
  );
  return result.insertId;
};

const updateVerificationToken = async (userId, token) => {
  await pool.query(
    "UPDATE users SET verification_token = ? WHERE id = ?",
    [token, userId]
  );
};

const markEmailVerified = async (userId) => {
  await pool.query(
    "UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?",
    [userId]
  );
};

const getUserByVerificationToken = async (token) => {
  const [rows] = await pool.query(
    "SELECT id, email_verified FROM users WHERE verification_token = ? LIMIT 1",
    [token]
  );
  return rows[0] || null;
};

const setPasswordResetToken = async (userId, token, expiresAt) => {
  await pool.query(
    "UPDATE users SET password_reset_token = ?, password_reset_expires_at = ? WHERE id = ?",
    [token, expiresAt, userId]
  );
};

const getUserByPasswordResetToken = async (token) => {
  const [rows] = await pool.query(
    `SELECT id, email, password_reset_expires_at
     FROM users
     WHERE password_reset_token = ?
     LIMIT 1`,
    [token]
  );
  return rows[0] || null;
};

const updatePasswordByUserId = async (userId, passwordHash) => {
  await pool.query(
    `UPDATE users
     SET password_hash = ?, password_reset_token = NULL, password_reset_expires_at = NULL
     WHERE id = ?`,
    [passwordHash, userId]
  );
};

const getAllUsers = async () => {
  const [rows] = await pool.query(
    `SELECT id, name, email, role, COALESCE(account_status, 'active') AS account_status
     FROM users
     ORDER BY role, name`
  );
  return rows;
};

const getLecturers = async () => {
  const [rows] = await pool.query(
    "SELECT id, name FROM users WHERE role = 'lecturer' ORDER BY name"
  );
  return rows;
};

const isLecturerId = async (id) => {
  if (!id) return false;
  const [rows] = await pool.query(
    "SELECT id FROM users WHERE id = ? AND role = 'lecturer' LIMIT 1",
    [id]
  );
  return rows.length > 0;
};

const updateUserRole = async (userId, role) => {
  await pool.query(
    "UPDATE users SET role = ? WHERE id = ?",
    [role, userId]
  );
};

const updateUserAccountStatus = async (userId, status) => {
  const safeStatus = String(status || "").toLowerCase() === "suspended" ? "suspended" : "active";
  await pool.query(
    `UPDATE users
     SET account_status = ?,
         suspended_at = CASE WHEN ? = 'suspended' THEN UTC_TIMESTAMP() ELSE NULL END
     WHERE id = ?`,
    [safeStatus, safeStatus, userId]
  );
};

const enableTwoFactor = async (userId, secret) => {
  await pool.query(
    "UPDATE users SET twofactor_secret = ?, is_2fa_enabled = 1 WHERE id = ?",
    [secret, userId]
  );
};

const disableTwoFactor = async (userId) => {
  await pool.query(
    "UPDATE users SET twofactor_secret = NULL, is_2fa_enabled = 0 WHERE id = ?",
    [userId]
  );
};

module.exports = {
  ensureAccountStatusColumns,
  ensurePasswordResetColumns,
  ensureTwoFactorColumns,
  getUserById,
  getUserWithTwoFactorById,
  getUserByEmail,
  createUser,
  updateVerificationToken,
  markEmailVerified,
  getUserByVerificationToken,
  setPasswordResetToken,
  getUserByPasswordResetToken,
  updatePasswordByUserId,
  getAllUsers,
  getLecturers,
  isLecturerId,
  updateUserRole,
  updateUserAccountStatus,
  enableTwoFactor,
  disableTwoFactor,
};
