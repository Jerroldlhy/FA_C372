const pool = require("./db");

const ensureTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS refund_requests (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      user_id INT NOT NULL,
      payment_id INT NULL,
      requested_amount DECIMAL(10,2) NOT NULL,
      reason TEXT NULL,
      status ENUM('pending','approved','rejected','failed','completed') NOT NULL DEFAULT 'pending',
      admin_note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_refund_request_order (order_id),
      INDEX idx_refund_request_user (user_id),
      INDEX idx_refund_request_status (status),
      CONSTRAINT fk_refund_request_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_refund_request_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_refund_request_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL
    )
  `);
};

const getPendingByOrder = async (orderId) => {
  const [rows] = await pool.query(
    `SELECT id, order_id, user_id, payment_id, requested_amount, reason, status, admin_note, created_at, updated_at
     FROM refund_requests
     WHERE order_id = ?
       AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [orderId]
  );
  return rows[0] || null;
};

const createRefundRequest = async ({ orderId, userId, paymentId = null, requestedAmount, reason = null }) => {
  const [result] = await pool.query(
    `INSERT INTO refund_requests (order_id, user_id, payment_id, requested_amount, reason, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [orderId, userId, paymentId, requestedAmount, reason]
  );
  return result.insertId;
};

const getByUser = async (userId) => {
  const [rows] = await pool.query(
    `SELECT rr.id, rr.order_id, rr.requested_amount, rr.reason, rr.status, rr.admin_note, rr.created_at, rr.updated_at,
            o.total_amount, o.refunded_amount, o.payment_status, p.method AS payment_method
     FROM refund_requests rr
     JOIN orders o ON o.id = rr.order_id
     LEFT JOIN payments p ON p.id = rr.payment_id
     WHERE rr.user_id = ?
     ORDER BY rr.created_at DESC`,
    [userId]
  );
  return rows;
};

const getByIdForUser = async (requestId, userId) => {
  const [rows] = await pool.query(
    `SELECT rr.id, rr.order_id, rr.user_id, rr.payment_id, rr.requested_amount, rr.reason, rr.status, rr.admin_note,
            rr.created_at, rr.updated_at, o.total_amount, o.refunded_amount, o.payment_status, p.method AS payment_method,
            p.provider_txn_id
     FROM refund_requests rr
     JOIN orders o ON o.id = rr.order_id
     LEFT JOIN payments p ON p.id = rr.payment_id
     WHERE rr.id = ?
       AND rr.user_id = ?
     LIMIT 1`,
    [requestId, userId]
  );
  return rows[0] || null;
};

const getById = async (requestId) => {
  const [rows] = await pool.query(
    `SELECT rr.id, rr.order_id, rr.user_id, rr.payment_id, rr.requested_amount, rr.reason, rr.status, rr.admin_note,
            rr.created_at, rr.updated_at, o.total_amount, o.refunded_amount, o.payment_status, u.name AS user_name,
            u.email AS user_email, p.method AS payment_method, p.provider_txn_id
     FROM refund_requests rr
     JOIN orders o ON o.id = rr.order_id
     JOIN users u ON u.id = rr.user_id
     LEFT JOIN payments p ON p.id = rr.payment_id
     WHERE rr.id = ?
     LIMIT 1`,
    [requestId]
  );
  return rows[0] || null;
};

const getAll = async () => {
  const [rows] = await pool.query(
    `SELECT rr.id, rr.order_id, rr.user_id, rr.payment_id, rr.requested_amount, rr.reason, rr.status, rr.admin_note,
            rr.created_at, rr.updated_at, u.name AS user_name, u.email AS user_email, o.total_amount, o.refunded_amount,
            p.method AS payment_method
     FROM refund_requests rr
     JOIN users u ON u.id = rr.user_id
     JOIN orders o ON o.id = rr.order_id
     LEFT JOIN payments p ON p.id = rr.payment_id
     ORDER BY rr.created_at DESC`
  );
  return rows;
};

const updateStatus = async (requestId, status, adminNote = null) => {
  const [result] = await pool.query(
    `UPDATE refund_requests
     SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, adminNote, requestId]
  );
  return Number(result.affectedRows || 0) > 0;
};

module.exports = {
  ensureTable,
  getPendingByOrder,
  createRefundRequest,
  getByUser,
  getByIdForUser,
  getById,
  getAll,
  updateStatus,
};
