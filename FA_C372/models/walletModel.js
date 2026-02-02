const pool = require("./db");

const getBalanceByUserId = async (userId) => {
  const [[row]] = await pool.query(
    "SELECT balance FROM wallet WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return row ? row.balance : 0;
};

const upsertTopUp = async (userId, amount) => {
  const [rows] = await pool.query(
    "SELECT wallet_id FROM wallet WHERE user_id = ? LIMIT 1",
    [userId]
  );
  if (!rows.length) {
    await pool.query("INSERT INTO wallet (user_id, balance) VALUES (?, ?)", [
      userId,
      amount,
    ]);
  } else {
    await pool.query(
      "UPDATE wallet SET balance = balance + ? WHERE user_id = ?",
      [amount, userId]
    );
  }
};

const adjustBalance = async (userId, delta) => {
  await pool.query("UPDATE wallet SET balance = balance + ? WHERE user_id = ?", [
    delta,
    userId,
  ]);
};

module.exports = {
  getBalanceByUserId,
  upsertTopUp,
  adjustBalance,
};
