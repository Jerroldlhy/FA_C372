const pool = require("./db");

const ensurePasswordResetColumns = async () => {
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(128) NULL"
  );
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at DATETIME NULL"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_users_password_reset_token ON users (password_reset_token)"
  );
};

const getUserByEmail = async (email) => {
  const [rows] = await pool.query(
    "SELECT id, name, email, password_hash, role, email_verified FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  return rows[0] || null;
};

const getUserById = async (userId) => {
  const [rows] = await pool.query(
    "SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1",
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
    "SELECT id, name, email, role FROM users ORDER BY role, name"
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

module.exports = {
  ensurePasswordResetColumns,
  getUserById,
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
};
