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
const {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  normaliseCurrency,
  convertAmount,
  getSymbol,
} = require("../services/currency");
const { addWalletBalance } = require("../models/walletModel");
const { createTransaction } = require("../models/transactionModel");

const getCartTotal = async (userId) => {
  const items = await getCartItemsForUser(userId);
  const total = items.reduce((sum, item) => {
    return sum + Number(item.price || 0) * Number(item.quantity || 1);
  }, 0);
  return { items, total: Number(total.toFixed(2)) };
};

const getTopUpRequest = (req) => {
  const rawAmount = req.body?.amount ?? req.session?.walletTopupDraft?.amount;
  const amount = Number(rawAmount);
  const currency = normaliseCurrency(
    req.body?.currency || req.session?.walletTopupDraft?.currency || req.session?.currency || DEFAULT_CURRENCY
  );
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Invalid top-up amount." };
  }
  const walletAmount = convertAmount(amount, currency, DEFAULT_CURRENCY);
  if (!walletAmount || walletAmount <= 0) {
    return { error: "Unable to convert top-up amount." };
  }
  return {
    amount: Number(amount.toFixed(2)),
    currency,
    walletAmount: Number(walletAmount.toFixed(2)),
  };
};

const startWalletTopUpPayment = async (req, res, next) => {
  try {
    const amount = Number(req.body.amount || 0);
    const currency = normaliseCurrency(req.body.currency || req.session?.currency || DEFAULT_CURRENCY);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.redirect("/wallet?topup_error=invalid_amount");
    }
    req.session.walletTopupDraft = {
      amount: Number(amount.toFixed(2)),
      currency,
    };
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    return res.redirect("/wallet/payment");
  } catch (err) {
    return next(err);
  }
};

const showWalletTopUpPayment = async (req, res, next) => {
  try {
    const draft = req.session?.walletTopupDraft || null;
    if (!draft || !Number(draft.amount)) {
      return res.redirect("/wallet?topup_error=missing_topup_details");
    }

    const amount = Number(draft.amount || 0);
    const currency = normaliseCurrency(draft.currency || DEFAULT_CURRENCY);

    return res.render("payment", {
      amount,
      currency,
      currencySymbol: getSymbol(currency),
      availableCurrencies: SUPPORTED_CURRENCIES,
      PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID || "",
      status: req.query,
    });
  } catch (err) {
    return next(err);
  }
};

const setWalletTopUpCurrency = async (req, res, next) => {
  try {
    const draft = req.session?.walletTopupDraft || null;
    if (!draft || !Number(draft.amount)) {
      return res.redirect("/wallet?topup_error=missing_topup_details");
    }
    draft.currency = normaliseCurrency(req.body.currency || draft.currency || DEFAULT_CURRENCY);
    req.session.walletTopupDraft = draft;
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    return res.redirect("/wallet/payment");
  } catch (err) {
    return next(err);
  }
};

const creditWalletTopUp = async (req, method, providerOrderId) => {
  const pending = req.session?.walletTopupPending || null;
  if (!pending) throw new Error("No pending top-up found.");
  if (providerOrderId && pending.providerOrderId && String(pending.providerOrderId) !== String(providerOrderId)) {
    throw new Error("Top-up reference mismatch.");
  }

  await addWalletBalance(req.user.id, Number(pending.walletAmount || 0));
  await createTransaction(
    req.user.id,
    `${String(method || "external").toLowerCase()}_topup`,
    Number(pending.walletAmount || 0),
    "completed"
  );

  req.session.walletTopupPending = null;
  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });

  return pending;
};

const createPaypalOrder = async (req, res, next) => {
  try {
    const { total } = await getCartTotal(req.user.id);
    if (!total) return res.status(400).json({ error: "Cart is empty." });
    const currency = normaliseCurrency(req.session?.currency || DEFAULT_CURRENCY);
    const chargedAmount = convertAmount(total, DEFAULT_CURRENCY, currency);

    const fraud = await assessPaymentAttempt(req, req.user.id, {
      amount: chargedAmount,
      provider: "paypal",
      method: "paypal",
      currency,
    });
    if (fraud.action === "block") {
      return res.status(429).json({ error: "Payment blocked due to risk checks." });
    }

    const order = await withRetries(() => createOrder(chargedAmount.toFixed(2), { currencyCode: currency }), {
      retries: 2,
      baseDelayMs: 250,
    });

    await createPaymentAttempt({
      userId: req.user.id,
      provider: "paypal",
      method: "paypal",
      status: "INITIATED",
      amount: chargedAmount,
      currency,
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
    const currency = normaliseCurrency(req.session?.currency || DEFAULT_CURRENCY);
    const chargedAmount = convertAmount(total, DEFAULT_CURRENCY, currency);

    const fraud = await assessPaymentAttempt(req, req.user.id, {
      amount: chargedAmount,
      provider: "stripe",
      method: "card",
      currency,
    });
    if (fraud.action === "block") {
      return res.status(429).json({ error: "Payment blocked due to risk checks." });
    }

    const host = `${req.protocol}://${req.get("host")}`;
    const session = await createCheckoutSession({
      amount: chargedAmount.toFixed(2),
      currency: String(currency).toLowerCase(),
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
      amount: chargedAmount,
      currency,
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

const readNetsStatusFlag = (status) => {
  if (!status) return { pending: true };

  const responseCode = String(status.response_code || "");
  const txnStatus = Number(status.txn_status);

  if (responseCode === "00" && txnStatus === 1) {
    return { success: true };
  }

  if (responseCode && responseCode !== "00") {
    return { fail: true, error: status.error_message || "NETS transaction failed." };
  }

  if (Number.isFinite(txnStatus) && txnStatus > 1) {
    return { fail: true, error: status.error_message || "NETS transaction failed." };
  }

  return { pending: true };
};

const requestNets = async (req, res, next) => {
  try {
    const { total } = await getCartTotal(req.user.id);
    if (!total) return res.redirect("/cart?payment_error=empty_cart");
    const selectedCurrency = normaliseCurrency(req.session?.currency || DEFAULT_CURRENCY);
    const netsAmount = convertAmount(total, DEFAULT_CURRENCY, "SGD");

    const fraud = await assessPaymentAttempt(req, req.user.id, {
      amount: netsAmount,
      provider: "nets",
      method: "nets",
      currency: "SGD",
    });
    if (fraud.action === "block") {
      return res.redirect("/cart?payment_error=nets_blocked");
    }

    const response = await requestNetsQr(netsAmount);
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
      amount: netsAmount,
      currency: "SGD",
      ipAddress: fraud.ipAddress,
      providerOrderId: data.txn_retrieval_ref,
    });

    return res.render("netsQr", {
      total: netsAmount,
      sourceCurrency: selectedCurrency,
      txnRetrievalRef: data.txn_retrieval_ref,
      qrCodeDataUri: `data:image/png;base64,${data.qr_code}`,
      statusUrl: `/payments/nets/status/${encodeURIComponent(data.txn_retrieval_ref)}`,
      retryUrl: "/cart",
      successUrl: `/payments/nets/success?txn_retrieval_ref=${encodeURIComponent(data.txn_retrieval_ref)}`,
      failUrl: `/payments/nets/fail?txn_retrieval_ref=${encodeURIComponent(data.txn_retrieval_ref)}&message=Cancelled`,
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
    const payload = data?.result?.data || data;
    return res.json({ ...readNetsStatusFlag(payload), raw: payload });
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
    return res.render("netsTxnSuccessStatus", {
      txnRetrievalRef,
      message: "NETS payment successful.",
      backUrl: "/cart?payment_ready=nets",
      backLabel: "Back to cart",
    });
  } catch (err) {
    next(err);
  }
};

const netsFail = async (req, res, next) => {
  try {
    const txnRetrievalRef = String(req.query.txn_retrieval_ref || "").trim();
    const message = String(req.query.message || "NETS transaction failed.");
    await updateAttemptStatusByProviderOrder(txnRetrievalRef, "FAILED", message);
    return res.render("netsTxnFailStatus", { message, backUrl: "/cart", backLabel: "Back to cart" });
  } catch (err) {
    next(err);
  }
};

const markPaymentFailed = async (req, res) => {
  req.session.payment = null;
  req.session.netsTxnRetrievalRef = null;
  req.session.walletTopupPending = null;
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

const setPaymentCurrency = async (req, res, next) => {
  try {
    const currency = normaliseCurrency(req.body.currency || DEFAULT_CURRENCY);
    req.session.currency = currency;
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    return res.redirect("/cart?currency_updated=1");
  } catch (err) {
    return next(err);
  }
};

const createTopUpPaypalOrder = async (req, res, next) => {
  try {
    const topup = getTopUpRequest(req);
    if (topup.error) return res.status(400).json({ error: topup.error });

    const fraud = await assessPaymentAttempt(req, req.user.id, {
      amount: topup.amount,
      provider: "paypal",
      method: "paypal_topup",
      currency: topup.currency,
    });
    if (fraud.action === "block") {
      return res.status(429).json({ error: "Payment blocked due to risk checks." });
    }

    const order = await withRetries(
      () => createOrder(topup.amount.toFixed(2), { currencyCode: topup.currency }),
      { retries: 2, baseDelayMs: 250 }
    );

    req.session.walletTopupPending = {
      method: "paypal",
      amount: topup.amount,
      currency: topup.currency,
      walletAmount: topup.walletAmount,
      providerOrderId: order.id,
    };
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    await createPaymentAttempt({
      userId: req.user.id,
      provider: "paypal",
      method: "paypal_topup",
      status: "INITIATED",
      amount: topup.amount,
      currency: topup.currency,
      ipAddress: fraud.ipAddress,
      providerOrderId: order.id,
    });

    return res.json(order);
  } catch (err) {
    console.error("PayPal top-up create order error:", err);
    return res.status(500).json({ error: err.message || "Failed to create PayPal top-up order." });
  }
};

const captureTopUpPaypalOrder = async (req, res, next) => {
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
      await updateAttemptStatusByProviderOrder(orderId, "FAILED", "Top-up capture not completed");
      return res.status(400).json({ error: "Payment capture not completed." });
    }

    await creditWalletTopUp(req, "paypal", orderId);
    await updateAttemptStatusByProviderOrder(orderId, "SUCCEEDED", null);
    return res.json({ ok: true, capture });
  } catch (err) {
    await updateAttemptStatusByProviderOrder(req.body?.orderId, "FAILED", err.message || "Top-up capture failed");
    console.error("PayPal top-up capture error:", err);
    return res.status(500).json({ error: err.message || "Failed to capture PayPal top-up payment." });
  }
};

const createTopUpStripeSession = async (req, res, next) => {
  try {
    const topup = getTopUpRequest(req);
    if (topup.error) return res.status(400).json({ error: topup.error });

    const fraud = await assessPaymentAttempt(req, req.user.id, {
      amount: topup.amount,
      provider: "stripe",
      method: "stripe_topup",
      currency: topup.currency,
    });
    if (fraud.action === "block") {
      return res.status(429).json({ error: "Payment blocked due to risk checks." });
    }

    const host = `${req.protocol}://${req.get("host")}`;
    const session = await createCheckoutSession({
      amount: topup.amount.toFixed(2),
      currency: String(topup.currency).toLowerCase(),
      description: "EduSphere wallet top-up",
      successUrl: `${host}/wallet/topup/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${host}/wallet?topup_error=stripe_cancelled`,
      customerEmail: req.user.email || undefined,
      clientReferenceId: String(req.user.id),
      metadata: { userId: String(req.user.id), mode: "wallet_topup" },
    });

    req.session.walletTopupPending = {
      method: "stripe",
      amount: topup.amount,
      currency: topup.currency,
      walletAmount: topup.walletAmount,
      providerOrderId: session.id,
    };
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    await createPaymentAttempt({
      userId: req.user.id,
      provider: "stripe",
      method: "stripe_topup",
      status: "INITIATED",
      amount: topup.amount,
      currency: topup.currency,
      ipAddress: fraud.ipAddress,
      providerOrderId: session.id,
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("Stripe top-up session error:", err);
    return res.status(500).json({ error: err.message || "Failed to create Stripe checkout session." });
  }
};

const stripeTopUpSuccess = async (req, res, next) => {
  try {
    const sessionId = String(req.query.session_id || "").trim();
    if (!sessionId) return res.redirect("/wallet?topup_error=stripe_session_missing");

    const session = await retrieveCheckoutSession(sessionId);
    const paid =
      String(session.payment_status || "").toLowerCase() === "paid" ||
      String(session.status || "").toLowerCase() === "complete";

    if (!paid) {
      await updateAttemptStatusByProviderOrder(sessionId, "FAILED", "Stripe top-up incomplete");
      return res.redirect("/wallet?topup_error=stripe_incomplete");
    }

    await creditWalletTopUp(req, "stripe", sessionId);
    await updateAttemptStatusByProviderOrder(sessionId, "SUCCEEDED", null);
    return res.redirect("/wallet?topup_success=1&method=stripe");
  } catch (err) {
    return next(err);
  }
};

const requestTopUpNets = async (req, res, next) => {
  try {
    const topup = getTopUpRequest(req);
    if (topup.error) return res.redirect("/wallet?topup_error=invalid_amount");
    const netsAmount = convertAmount(topup.amount, topup.currency, "SGD");

    const fraud = await assessPaymentAttempt(req, req.user.id, {
      amount: netsAmount,
      provider: "nets",
      method: "nets_topup",
      currency: "SGD",
    });
    if (fraud.action === "block") {
      return res.redirect("/wallet?topup_error=nets_blocked");
    }

    const response = await requestNetsQr(netsAmount);
    const data = response?.result?.data || null;
    if (!data?.txn_retrieval_ref || !data?.qr_code) {
      return res.redirect("/wallet?topup_error=nets_qr_failed");
    }

    req.session.walletTopupPending = {
      method: "nets",
      amount: topup.amount,
      currency: topup.currency,
      walletAmount: topup.walletAmount,
      providerOrderId: data.txn_retrieval_ref,
    };
    req.session.netsTxnRetrievalRef = data.txn_retrieval_ref;
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    await createPaymentAttempt({
      userId: req.user.id,
      provider: "nets",
      method: "nets_topup",
      status: "INITIATED",
      amount: netsAmount,
      currency: "SGD",
      ipAddress: fraud.ipAddress,
      providerOrderId: data.txn_retrieval_ref,
    });

    return res.render("netsQr", {
      total: netsAmount,
      sourceCurrency: topup.currency,
      txnRetrievalRef: data.txn_retrieval_ref,
      qrCodeDataUri: `data:image/png;base64,${data.qr_code}`,
      statusUrl: `/payments/nets/status/${encodeURIComponent(data.txn_retrieval_ref)}`,
      retryUrl: "/wallet/payment",
      successUrl: `/wallet/topup/nets/success?txn_retrieval_ref=${encodeURIComponent(data.txn_retrieval_ref)}`,
      failUrl: `/wallet/topup/nets/fail?txn_retrieval_ref=${encodeURIComponent(data.txn_retrieval_ref)}&message=Cancelled`,
    });
  } catch (err) {
    return next(err);
  }
};

const netsTopUpSuccess = async (req, res, next) => {
  try {
    const txnRetrievalRef = String(req.query.txn_retrieval_ref || "").trim();
    if (!txnRetrievalRef || req.session.netsTxnRetrievalRef !== txnRetrievalRef) {
      return res.redirect("/wallet?topup_error=nets_invalid_ref");
    }
    await creditWalletTopUp(req, "nets", txnRetrievalRef);
    req.session.netsTxnRetrievalRef = null;
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    await updateAttemptStatusByProviderOrder(txnRetrievalRef, "SUCCEEDED", null);
    return res.render("netsTxnSuccessStatus", {
      txnRetrievalRef,
      message: "NETS top-up successful. Your wallet has been credited.",
      backUrl: "/wallet?topup_success=1&method=nets",
      backLabel: "Back to wallet",
    });
  } catch (err) {
    return next(err);
  }
};

const netsTopUpFail = async (req, res, next) => {
  try {
    const txnRetrievalRef = String(req.query.txn_retrieval_ref || "").trim();
    const message = String(req.query.message || "NETS top-up failed.");
    await updateAttemptStatusByProviderOrder(txnRetrievalRef, "FAILED", message);
    req.session.walletTopupPending = null;
    req.session.netsTxnRetrievalRef = null;
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    return res.render("netsTxnFailStatus", {
      message,
      backUrl: "/wallet/payment",
      backLabel: "Back to payment page",
    });
  } catch (err) {
    return next(err);
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
  setPaymentCurrency,
  createTopUpPaypalOrder,
  captureTopUpPaypalOrder,
  createTopUpStripeSession,
  stripeTopUpSuccess,
  requestTopUpNets,
  netsTopUpSuccess,
  netsTopUpFail,
  startWalletTopUpPayment,
  showWalletTopUpPayment,
  setWalletTopUpCurrency,
};
