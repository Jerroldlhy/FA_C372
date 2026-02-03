const { getCartItemsForUser } = require("../models/cartModel");
const { getTransactionsForUser } = require("../models/transactionModel");
const {
  updateAttemptStatusByProviderOrder,
  createPaymentAttempt,
} = require("../models/paymentAttemptModel");
const { createOrder, captureOrder } = require("../services/paypal");
const { createCheckoutSession, retrieveCheckoutSession } = require("../services/stripe");
const { withRetries } = require("../services/retry");
const { assessPaymentAttempt } = require("../services/fraud");
const { requestNetsQr, queryNetsQr } = require("../services/nets");

const getCartTotal = async (userId) => {
  const items = await getCartItemsForUser(userId);
  const total = items.reduce((sum, item) => {
    return sum + Number(item.price || 0) * Number(item.quantity || 1);
  }, 0);
  return { items, total: Number(total.toFixed(2)) };
};

const createPaypalOrder = async (req, res, next) => {
  try {
    const { total } = await getCartTotal(req.user.id);
    if (!total) return res.status(400).json({ error: "Cart is empty." });

    const fraud = await assessPaymentAttempt(req, req.user.id, {
      amount: total,
      provider: "paypal",
      method: "paypal",
      currency: "USD",
    });
    if (fraud.action === "block") {
      return res.status(429).json({ error: "Payment blocked due to risk checks." });
    }

    const order = await withRetries(() => createOrder(total.toFixed(2), { currencyCode: "USD" }), {
      retries: 2,
      baseDelayMs: 250,
    });

    await createPaymentAttempt({
      userId: req.user.id,
      provider: "paypal",
      method: "paypal",
      status: "INITIATED",
      amount: total,
      currency: "USD",
      ipAddress: fraud.ipAddress,
      providerOrderId: order.id,
    });

    return res.json(order);
  } catch (err) {
    next(err);
  }
};

const capturePaypalOrder = async (req, res, next) => {
  try {
    const orderId = String(req.body.orderId || "").trim();
    if (!orderId) return res.status(400).json({ error: "orderId is required." });

    const capture = await withRetries(() => captureOrder(orderId), {
      retries: 2,
      baseDelayMs: 300,
    });

    const payments = capture?.purchase_units?.[0]?.payments;
    const captureId = payments?.captures?.[0]?.id || payments?.authorizations?.[0]?.id || null;
    if (!captureId || capture?.status !== "COMPLETED") {
      await updateAttemptStatusByProviderOrder(orderId, "FAILED", "Capture not completed");
      return res.status(400).json({ error: "Payment capture not completed." });
    }

    req.session.payment = { method: "paypal", captureId };
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    await updateAttemptStatusByProviderOrder(orderId, "SUCCEEDED", null);
    return res.json({ ok: true, capture });
  } catch (err) {
    await updateAttemptStatusByProviderOrder(req.body?.orderId, "FAILED", err.message || "Capture failed");
    next(err);
  }
};

const createStripeSession = async (req, res, next) => {
  try {
    const { total } = await getCartTotal(req.user.id);
    if (!total) return res.status(400).json({ error: "Cart is empty." });

    const fraud = await assessPaymentAttempt(req, req.user.id, {
      amount: total,
      provider: "stripe",
      method: "card",
      currency: "USD",
    });
    if (fraud.action === "block") {
      return res.status(429).json({ error: "Payment blocked due to risk checks." });
    }

    const host = `${req.protocol}://${req.get("host")}`;
    const session = await createCheckoutSession({
      amount: total.toFixed(2),
      currency: "usd",
      description: "EduSphere course checkout",
      successUrl: `${host}/payments/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${host}/payments/stripe/cancel`,
      customerEmail: req.user.email || undefined,
      clientReferenceId: String(req.user.id),
      metadata: { userId: String(req.user.id) },
    });

    await createPaymentAttempt({
      userId: req.user.id,
      provider: "stripe",
      method: "card",
      status: "INITIATED",
      amount: total,
      currency: "USD",
      ipAddress: fraud.ipAddress,
      providerOrderId: session.id,
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    next(err);
  }
};

const stripeSuccess = async (req, res, next) => {
  try {
    const sessionId = String(req.query.session_id || "").trim();
    if (!sessionId) return res.redirect("/cart?payment_error=stripe_session_missing");

    const session = await retrieveCheckoutSession(sessionId);
    const paid =
      String(session.payment_status || "").toLowerCase() === "paid" ||
      String(session.status || "").toLowerCase() === "complete";

    if (!paid) {
      await updateAttemptStatusByProviderOrder(sessionId, "FAILED", "Stripe payment incomplete");
      return res.redirect("/cart?payment_error=stripe_incomplete");
    }

    req.session.payment = {
      method: "stripe",
      captureId: session.payment_intent ? String(session.payment_intent) : sessionId,
    };
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    await updateAttemptStatusByProviderOrder(sessionId, "SUCCEEDED", null);
    return res.redirect("/cart?payment_ready=stripe");
  } catch (err) {
    next(err);
  }
};

const stripeCancel = (req, res) => {
  res.redirect("/cart?payment_error=stripe_cancelled");
};

const requestNets = async (req, res, next) => {
  try {
    const { total } = await getCartTotal(req.user.id);
    if (!total) return res.redirect("/cart?payment_error=empty_cart");

    const fraud = await assessPaymentAttempt(req, req.user.id, {
      amount: total,
      provider: "nets",
      method: "nets",
      currency: "SGD",
    });
    if (fraud.action === "block") {
      return res.redirect("/cart?payment_error=nets_blocked");
    }

    const response = await requestNetsQr(total);
    const data = response?.result?.data || null;
    if (!data?.txn_retrieval_ref || !data?.qr_code) {
      return res.redirect("/cart?payment_error=nets_qr_failed");
    }

    req.session.netsTxnRetrievalRef = data.txn_retrieval_ref;
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    await createPaymentAttempt({
      userId: req.user.id,
      provider: "nets",
      method: "nets",
      status: "INITIATED",
      amount: total,
      currency: "SGD",
      ipAddress: fraud.ipAddress,
      providerOrderId: data.txn_retrieval_ref,
    });

    return res.render("netsQr", {
      total,
      txnRetrievalRef: data.txn_retrieval_ref,
      qrCodeDataUri: `data:image/png;base64,${data.qr_code}`,
    });
  } catch (err) {
    next(err);
  }
};

const netsStatus = async (req, res, next) => {
  try {
    const txnRetrievalRef = String(req.params.txnRetrievalRef || "").trim();
    if (!txnRetrievalRef) return res.status(400).json({ error: "Missing txnRetrievalRef." });
    const data = await queryNetsQr(txnRetrievalRef);
    return res.json(data?.result?.data || data);
  } catch (err) {
    next(err);
  }
};

const netsSuccess = async (req, res, next) => {
  try {
    const txnRetrievalRef = String(req.query.txn_retrieval_ref || "").trim();
    if (!txnRetrievalRef || req.session.netsTxnRetrievalRef !== txnRetrievalRef) {
      return res.redirect("/cart?payment_error=nets_invalid_ref");
    }

    req.session.payment = { method: "nets", captureId: txnRetrievalRef };
    req.session.netsTxnRetrievalRef = null;
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    await updateAttemptStatusByProviderOrder(txnRetrievalRef, "SUCCEEDED", null);
    return res.render("netsTxnSuccessStatus", { txnRetrievalRef });
  } catch (err) {
    next(err);
  }
};

const netsFail = async (req, res, next) => {
  try {
    const txnRetrievalRef = String(req.query.txn_retrieval_ref || "").trim();
    const message = String(req.query.message || "NETS transaction failed.");
    await updateAttemptStatusByProviderOrder(txnRetrievalRef, "FAILED", message);
    return res.render("netsTxnFailStatus", { message });
  } catch (err) {
    next(err);
  }
};

const markPaymentFailed = async (req, res) => {
  req.session.payment = null;
  req.session.netsTxnRetrievalRef = null;
  req.session.save(() => res.json({ ok: true }));
};

const listMyTransactions = async (req, res, next) => {
  try {
    const transactions = await getTransactionsForUser(req.user.id, 50);
    return res.json({ data: transactions });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createPaypalOrder,
  capturePaypalOrder,
  createStripeSession,
  stripeSuccess,
  stripeCancel,
  requestNets,
  netsStatus,
  netsSuccess,
  netsFail,
  markPaymentFailed,
  listMyTransactions,
};
