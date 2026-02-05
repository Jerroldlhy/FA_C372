const pool = require("../db");

const getWalletBalance = async (userId) => {
  const [rows] = await pool.query(
    "SELECT balance FROM wallet WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return rows.length ? Number(rows[0].balance) : 0;
};

const addWalletBalance = async (userId, amount) => {
  await pool.query(
    "INSERT INTO wallet (user_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)",
    [userId, amount]
  );
};

const deductWalletBalance = async (userId, amount) => {
  await pool.query(
    "UPDATE wallet SET balance = balance - ? WHERE user_id = ?",
    [amount, userId]
  );
};

module.exports = {
  getWalletBalance,
  addWalletBalance,
  deductWalletBalance,
};
