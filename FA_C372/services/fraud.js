const {
  createPaymentAttempt,
  countRecentAttempts,
  countRecentFailures,
} = require("../models/paymentAttemptModel");
const pool = require("../models/db");

const MAX_ATTEMPTS_PER_WINDOW = Number(process.env.FRAUD_MAX_ATTEMPTS || 5);
const MAX_FAILED_PER_WINDOW = Number(process.env.FRAUD_MAX_FAILED || 3);
const WINDOW_MINUTES = Number(process.env.FRAUD_WINDOW_MINUTES || 10);
const BLOCK_ON_RISK = String(process.env.FRAUD_BLOCK || "true").toLowerCase() === "true";
const MAX_AMOUNT = Number(process.env.FRAUD_MAX_AMOUNT || 0);

const assessPaymentAttempt = async (req, userId, context = {}) => {
  const ipAddress = String(
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || ""
  ).slice(0, 45);

  const attempts = await countRecentAttempts({ userId, ipAddress, minutes: WINDOW_MINUTES });
  const fails = await countRecentFailures({ userId, ipAddress, minutes: WINDOW_MINUTES });

  const flags = [];
  let riskScore = 0;

  if (attempts >= MAX_ATTEMPTS_PER_WINDOW) {
    flags.push("velocity");
    riskScore += 70;
  }

  if (fails >= MAX_FAILED_PER_WINDOW) {
    flags.push("rapid_failures");
    riskScore += 50;
  }

  const amount = Number(context.amount || 0);
  if (MAX_AMOUNT > 0 && Number.isFinite(amount) && amount >= MAX_AMOUNT) {
    flags.push("high_amount");
    riskScore += 40;
  }

  const action = riskScore >= 70 && BLOCK_ON_RISK ? "block" : riskScore >= 40 ? "review" : "allow";
  const severity = action === "block" ? "high" : action === "review" ? "medium" : "low";
  const ruleCode = flags[0] || "ok";

  await pool.query(
    `INSERT INTO fraud_events (user_id, payment_id, rule_code, severity, details)
     VALUES (?, NULL, ?, ?, ?)`,
    [
      userId || null,
      ruleCode,
      severity,
      JSON.stringify({ action, riskScore, flags, ipAddress, amount }),
    ]
  );

  if (context.provider && context.method) {
    await createPaymentAttempt({
      userId,
      orderId: context.orderId || null,
      provider: context.provider,
      method: context.method,
      status: action === "block" ? "FAILED" : "INITIATED",
      amount,
      currency: context.currency || null,
      ipAddress,
      failureReason: action === "block" ? "Blocked by fraud rules" : null,
      providerOrderId: context.providerOrderId || null,
    });
  }

  return { action, riskScore, flags, ipAddress };
};

module.exports = { assessPaymentAttempt };
