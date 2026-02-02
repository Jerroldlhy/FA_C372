const pool = require("./db");

const createWalletTransaction = async ({
  user_id,
  amount,
  transaction_type,
  transaction_status = "completed",
  notes,
}) => {
  const [result] = await pool.query(
    `INSERT INTO transactions
      (user_id, amount, transaction_type, transaction_status, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [user_id, amount, transaction_type, transaction_status, notes || null]
  );
  return result.insertId;
};

const listWalletTransactionsByUser = async (userId) => {
  const [rows] = await pool.query(
    `SELECT transaction_id, user_id, amount, transaction_type, transaction_status, notes, created_at
     FROM transactions
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
};

module.exports = {
  createWalletTransaction,
  listWalletTransactionsByUser,
};
