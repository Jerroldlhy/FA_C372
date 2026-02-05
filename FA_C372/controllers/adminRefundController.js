const pool = require("../models/db");
const {
  getById,
  getAll,
  updateStatus,
} = require("../models/refundRequestModel");
const { getByRequestId, createRefundTransaction } = require("../models/refundTransactionModel");

const list = async (req, res, next) => {
  try {
    const requests = await getAll();
    return res.render("adminRefunds", { requests, status: req.query });
  } catch (err) {
    return next(err);
  }
};

const details = async (req, res, next) => {
  try {
    const requestId = Number(req.params.id || 0);
    if (!Number.isInteger(requestId) || requestId <= 0) return res.redirect("/admin/refunds");
    const request = await getById(requestId);
    if (!request) return res.redirect("/admin/refunds");
    const refunds = await getByRequestId(requestId);
    return res.render("adminRefundDetails", { request, refunds, status: req.query });
  } catch (err) {
    return next(err);
  }
};

const approve = async (req, res, next) => {
  const requestId = Number(req.params.id || 0);
  if (!Number.isInteger(requestId) || requestId <= 0) return res.redirect("/admin/refunds");

  try {
    const request = await getById(requestId);
    if (!request) return res.redirect("/admin/refunds");
    if (String(request.status || "").toLowerCase() !== "pending") {
      return res.redirect(`/admin/refunds/${requestId}?refund_error=not_pending`);
    }

    const paymentMethod = String(request.payment_method || "").toLowerCase() || "external";

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [lockedOrderRows] = await connection.query(
        `SELECT id, user_id, total_amount, refunded_amount, payment_status
         FROM orders
         WHERE id = ?
         FOR UPDATE`,
        [request.order_id]
      );
      const lockedOrder = lockedOrderRows[0];
      if (!lockedOrder) {
        throw new Error("Order not found.");
      }
      if (String(lockedOrder.payment_status || "").toLowerCase() === "refunded" || Number(lockedOrder.refunded_amount || 0) > 0) {
        throw new Error("Order already refunded.");
      }

      await createRefundTransaction(
        {
          refundRequestId: requestId,
          orderId: request.order_id,
          paymentId: request.payment_id || null,
          provider: "wallet",
          providerRefundId: null,
          providerTxnId: request.provider_txn_id || null,
          amount: Number(lockedOrder.total_amount || 0),
          currency: "SGD",
          status: "completed",
          rawResponse: {
            mode: "wallet_credit",
            sourcePaymentMethod: paymentMethod,
            approvedBy: req.user?.id || null,
          },
        },
        connection
      );

      await connection.query(
        `UPDATE orders
         SET refunded_amount = total_amount,
             payment_status = 'refunded'
         WHERE id = ?`,
        [request.order_id]
      );

      await connection.query(
        `UPDATE payments
         SET status = 'refunded'
         WHERE id = ?`,
        [request.payment_id]
      );

      await connection.query(
        `INSERT INTO wallet (user_id, balance)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)`,
        [request.user_id, Number(lockedOrder.total_amount || 0)]
      );

      await connection.query(
        `DELETE FROM enrollments
         WHERE student_id = ?
           AND course_id IN (
             SELECT oi.course_id
             FROM order_items oi
             WHERE oi.order_id = ?
           )`,
        [request.user_id, request.order_id]
      );

      await connection.query(
        `INSERT INTO transactions (user_id, type, amount, status)
         VALUES (?, ?, ?, 'completed')`,
        [request.user_id, "wallet_refund_credit", Number(lockedOrder.total_amount || 0)]
      );

      await connection.query(
        `UPDATE refund_requests
         SET status = 'completed',
             admin_note = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [String(req.body.admin_note || "").trim() || "Refund approved.", requestId]
      );

      await connection.commit();
      return res.redirect(`/admin/refunds/${requestId}?refund_success=approved`);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    try {
      await updateStatus(requestId, "failed", err.message || "Refund failed.");
    } catch (_) {
      // no-op
    }
    return res.redirect(`/admin/refunds/${requestId}?refund_error=approve_failed`);
  }
};

const reject = async (req, res, next) => {
  const requestId = Number(req.params.id || 0);
  if (!Number.isInteger(requestId) || requestId <= 0) return res.redirect("/admin/refunds");

  try {
    const request = await getById(requestId);
    if (!request) return res.redirect("/admin/refunds");
    if (String(request.status || "").toLowerCase() !== "pending") {
      return res.redirect(`/admin/refunds/${requestId}?refund_error=not_pending`);
    }
    await updateStatus(requestId, "rejected", String(req.body.admin_note || "").trim() || "Refund rejected.");
    return res.redirect(`/admin/refunds/${requestId}?refund_success=rejected`);
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  list,
  details,
  approve,
  reject,
};
