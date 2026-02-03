const pool = require("./db");

const getUserByEmail = async (email) => {
  const [rows] = await pool.query(
    "SELECT id, name, email, password_hash, role, email_verified FROM users WHERE email = ? LIMIT 1",
    [email]
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

module.exports = {
  getUserByEmail,
  createUser,
  updateVerificationToken,
  markEmailVerified,
  getUserByVerificationToken,
  getAllUsers,
  getLecturers,
  isLecturerId,
};
