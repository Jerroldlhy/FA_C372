const pool = require("./db");

const listByUserId = async (userId) => {
  const [rows] = await pool.query(
    `SELECT transaction_id, transaction_type, amount, transaction_status, created_at
     FROM transactions
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
};

const createTransaction = async ({
  user_id,
  transaction_type,
  amount,
  transaction_status,
}) => {
  const [result] = await pool.query(
    "INSERT INTO transactions (user_id, transaction_type, amount, transaction_status) VALUES (?, ?, ?, ?)",
    [user_id, transaction_type, amount, transaction_status]
  );
  return result.insertId;
};

const countTransactions = async () => {
  const [[row]] = await pool.query(
    "SELECT COUNT(*) AS total_transactions FROM transactions"
  );
  return row.total_transactions || 0;
};

const listAll = async () => {
  const [rows] = await pool.query(
    `SELECT transaction_id, user_id, transaction_type, amount, transaction_status, created_at
     FROM transactions
     ORDER BY created_at DESC`
  );
  return rows;
};

module.exports = {
  listByUserId,
  createTransaction,
  countTransactions,
  listAll,
};
