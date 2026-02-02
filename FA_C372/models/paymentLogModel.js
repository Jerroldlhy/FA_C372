const pool = require("./db");

const createPaymentLog = async ({
  user_id,
  payment_method,
  payment_status,
  amount,
  transaction_id,
}) => {
  const [result] = await pool.query(
    `INSERT INTO payment_api_logs
      (user_id, payment_method, payment_status, amount, transaction_id)
     VALUES (?, ?, ?, ?, ?)`,
    [user_id, payment_method, payment_status, amount, transaction_id || null]
  );
  return result.insertId;
};

module.exports = {
  createPaymentLog,
};
