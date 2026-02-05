const pool = require("../db");

const createTransaction = async (userId, type, amount, status) => {
  await pool.query(
    "INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, ?)",
    [userId, type, amount, status]
  );
};

const getTransactionsForUser = async (userId, limit = null) => {
  const [rows] = await pool.query(
    `SELECT id, type, amount, status, created_at
     FROM transactions
     WHERE user_id = ?
     ORDER BY created_at DESC
     ${limit ? "LIMIT ?" : ""}`,
    limit ? [userId, limit] : [userId]
  );
  return rows;
};

const getAllTransactions = async () => {
  const [rows] = await pool.query(
    "SELECT id, user_id, type, amount, status, created_at FROM transactions ORDER BY created_at DESC"
  );
  return rows;
};

module.exports = {
  createTransaction,
  getTransactionsForUser,
  getAllTransactions,
};
