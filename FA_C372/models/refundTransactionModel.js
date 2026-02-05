const pool = require("./db");

const ensureTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS refund_transactions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      refund_request_id INT NOT NULL,
      order_id INT NOT NULL,
      payment_id INT NULL,
      provider VARCHAR(40) NOT NULL,
      provider_refund_id VARCHAR(128) NULL,
      provider_txn_id VARCHAR(128) NULL,
      amount DECIMAL(10,2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'SGD',
      status VARCHAR(40) NOT NULL,
      raw_response JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_refund_txn_request (refund_request_id),
      INDEX idx_refund_txn_order (order_id),
      INDEX idx_refund_txn_provider_ref (provider_refund_id),
      CONSTRAINT fk_refund_txn_request FOREIGN KEY (refund_request_id) REFERENCES refund_requests(id) ON DELETE CASCADE,
      CONSTRAINT fk_refund_txn_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_refund_txn_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL
    )
  `);
};

const createRefundTransaction = async (data, connection = pool) => {
  const [result] = await connection.query(
    `INSERT INTO refund_transactions
      (refund_request_id, order_id, payment_id, provider, provider_refund_id, provider_txn_id, amount, currency, status, raw_response)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.refundRequestId,
      data.orderId,
      data.paymentId || null,
      data.provider,
      data.providerRefundId || null,
      data.providerTxnId || null,
      data.amount,
      data.currency || "SGD",
      data.status || "completed",
      data.rawResponse ? JSON.stringify(data.rawResponse) : null,
    ]
  );
  return result.insertId;
};

const getByRequestId = async (requestId) => {
  const [rows] = await pool.query(
    `SELECT id, refund_request_id, order_id, payment_id, provider, provider_refund_id, provider_txn_id,
            amount, currency, status, raw_response, created_at
     FROM refund_transactions
     WHERE refund_request_id = ?
     ORDER BY created_at DESC`,
    [requestId]
  );
  return rows.map((row) => {
    let rawResponse = row.raw_response;
    try {
      rawResponse = typeof rawResponse === "string" ? JSON.parse(rawResponse) : rawResponse;
    } catch {
      rawResponse = row.raw_response;
    }
    return { ...row, raw_response: rawResponse };
  });
};

module.exports = {
  ensureTable,
  createRefundTransaction,
  getByRequestId,
};
