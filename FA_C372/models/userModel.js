const pool = require("./db");

const findByEmail = async (email) => {
  const [rows] = await pool.query(
    "SELECT user_id, email, password, role, username, first_name, last_name FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  return rows[0] || null;
};

const createUser = async ({ username, email, password, role }) => {
  const [result] = await pool.query(
    "INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)",
    [username, email, password, role]
  );
  return result.insertId;
};

const findById = async (userId) => {
  const [rows] = await pool.query(
    `SELECT user_id, username, first_name, last_name, email, role, created_at
     FROM users
     WHERE user_id = ?
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
};

const listUsers = async (role) => {
  const [rows] = await pool.query(
    `SELECT user_id, username, first_name, last_name, email, role
     FROM users
     ${role ? "WHERE role = ?" : ""}
     ORDER BY role, username`,
    role ? [role] : []
  );
  return rows;
};

const updateUserRole = async (userId, role) => {
  await pool.query("UPDATE users SET role = ? WHERE user_id = ?", [role, userId]);
};

const deleteUserById = async (userId) => {
  await pool.query("DELETE FROM users WHERE user_id = ?", [userId]);
};

const countUsers = async () => {
  const [[row]] = await pool.query("SELECT COUNT(*) AS total_users FROM users");
  return row.total_users || 0;
};

module.exports = {
  findByEmail,
  findById,
  createUser,
  listUsers,
  updateUserRole,
  deleteUserById,
  countUsers,
};
