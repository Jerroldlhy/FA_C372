const { getOrderPaymentForUser } = require("../models/orderModel");
const {
  getPendingByOrder,
  createRefundRequest,
  getByUser,
  getByIdForUser,
} = require("../models/refundRequestModel");
const { getByRequestId } = require("../models/refundTransactionModel");

const list = async (req, res, next) => {
  try {
    const requests = await getByUser(req.user.id);
    return res.render("refunds", { requests, status: req.query });
  } catch (err) {
    return next(err);
  }
};

const showRequestForm = async (req, res, next) => {
  try {
    const orderId = Number(req.params.orderId || 0);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.redirect("/orders?refund_error=invalid_order");
    }
    const order = await getOrderPaymentForUser(orderId, req.user.id);
    if (!order) return res.redirect("/orders?refund_error=invalid_order");

    if (String(order.payment_status || "").toLowerCase() !== "paid") {
      return res.redirect(`/orders/${orderId}?refund_error=not_refundable`);
    }

    if (Number(order.refunded_amount || 0) > 0) {
      return res.redirect(`/orders/${orderId}?refund_error=already_refunded`);
    }

    const pending = await getPendingByOrder(orderId);
    if (pending) {
      return res.redirect(`/orders/${orderId}?refund_error=pending_exists`);
    }

    return res.render("refundRequest", { order, status: req.query });
  } catch (err) {
    return next(err);
  }
};

const submitRequest = async (req, res, next) => {
  try {
    const orderId = Number(req.params.orderId || 0);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.redirect("/orders?refund_error=invalid_order");
    }
    const order = await getOrderPaymentForUser(orderId, req.user.id);
    if (!order) return res.redirect("/orders?refund_error=invalid_order");

    if (String(order.payment_status || "").toLowerCase() !== "paid") {
      return res.redirect(`/orders/${orderId}?refund_error=not_refundable`);
    }
    if (Number(order.refunded_amount || 0) > 0) {
      return res.redirect(`/orders/${orderId}?refund_error=already_refunded`);
    }

    const pending = await getPendingByOrder(orderId);
    if (pending) {
      return res.redirect(`/orders/${orderId}?refund_error=pending_exists`);
    }

    const reason = String(req.body.reason || "").trim();
    await createRefundRequest({
      orderId,
      userId: req.user.id,
      paymentId: order.payment_id || null,
      requestedAmount: Number(order.total_amount || 0),
      reason: reason || null,
    });

    return res.redirect("/refunds?refund_requested=1");
  } catch (err) {
    return next(err);
  }
};

const details = async (req, res, next) => {
  try {
    const requestId = Number(req.params.id || 0);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.redirect("/refunds");
    }
    const request = await getByIdForUser(requestId, req.user.id);
    if (!request) return res.redirect("/refunds");
    const refunds = await getByRequestId(requestId);
    return res.render("refundDetails", { request, refunds, status: req.query });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  list,
  showRequestForm,
  submitRequest,
  details,
};
