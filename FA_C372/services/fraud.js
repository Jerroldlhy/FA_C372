const {
  createPaymentAttempt,
  countRecentAttempts,
  countRecentFailures,
} = require("../models/paymentAttemptModel");
const pool = require("../db");

const MAX_ATTEMPTS_PER_WINDOW = Number(process.env.FRAUD_MAX_ATTEMPTS || 5);
const MAX_FAILED_PER_WINDOW = Number(process.env.FRAUD_MAX_FAILED || 3);
const WINDOW_MINUTES = Number(process.env.FRAUD_WINDOW_MINUTES || 10);
const BLOCK_ON_RISK = String(process.env.FRAUD_BLOCK || "true").toLowerCase() === "true";
const MAX_AMOUNT = Number(process.env.FRAUD_MAX_AMOUNT || 0);
const AML_SINGLE_TOPUP_LIMIT = Number(process.env.AML_SINGLE_TOPUP_LIMIT || 2000);
const AML_DAILY_TOPUP_LIMIT = Number(process.env.AML_DAILY_TOPUP_LIMIT || 5000);
const AML_TOPUP_BURST_WINDOW_MINUTES = Number(process.env.AML_TOPUP_BURST_WINDOW_MINUTES || 60);
const AML_TOPUP_BURST_COUNT = Number(process.env.AML_TOPUP_BURST_COUNT || 4);
const AML_STRUCTURING_WINDOW_MINUTES = Number(process.env.AML_STRUCTURING_WINDOW_MINUTES || 180);
const AML_STRUCTURING_THRESHOLD = Number(process.env.AML_STRUCTURING_THRESHOLD || 1000);
const AML_STRUCTURING_COUNT = Number(process.env.AML_STRUCTURING_COUNT || 3);
const AML_BLOCK_ON_SUSPICIOUS =
  String(process.env.AML_BLOCK_ON_SUSPICIOUS || "false").toLowerCase() === "true";

const getTopUpMetrics = async (userId, amount) => {
  if (!userId) {
    return {
      recentTopUpCount: 0,
      recentSubThresholdCount: 0,
      recentSubThresholdTotal: 0,
      dailyTopUpTotal: 0,
    };
  }

  const [burstRows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM transactions
     WHERE user_id = ?
       AND status = 'completed'
       AND LOWER(type) LIKE '%topup%'
       AND created_at >= (NOW() - INTERVAL ? MINUTE)`,
    [userId, AML_TOPUP_BURST_WINDOW_MINUTES]
  );

  const [dailyRows] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE user_id = ?
       AND status = 'completed'
       AND LOWER(type) LIKE '%topup%'
       AND created_at >= (NOW() - INTERVAL 1 DAY)`,
    [userId]
  );

  const threshold = Math.max(1, AML_STRUCTURING_THRESHOLD);
  const [structuringRows] = await pool.query(
    `SELECT COUNT(*) AS total_count, COALESCE(SUM(amount), 0) AS total_amount
     FROM transactions
     WHERE user_id = ?
       AND status = 'completed'
       AND LOWER(type) LIKE '%topup%'
       AND amount > 0
       AND amount < ?
       AND created_at >= (NOW() - INTERVAL ? MINUTE)`,
    [userId, threshold, AML_STRUCTURING_WINDOW_MINUTES]
  );

  return {
    recentTopUpCount: Number(burstRows[0]?.total || 0),
    recentSubThresholdCount: Number(structuringRows[0]?.total_count || 0),
    recentSubThresholdTotal: Number(structuringRows[0]?.total_amount || 0),
    dailyTopUpTotal: Number(dailyRows[0]?.total || 0),
    incomingAmount: Number(amount || 0),
  };
};

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

  const method = String(context.method || "").toLowerCase();
  const flow = String(context.flow || "").toLowerCase();
  const isTopUpFlow = method.includes("topup") || flow === "topup";
  let aml = null;
  if (isTopUpFlow) {
    aml = await getTopUpMetrics(userId, amount);

    if (AML_SINGLE_TOPUP_LIMIT > 0 && amount >= AML_SINGLE_TOPUP_LIMIT) {
      flags.push("aml_single_topup_limit");
      riskScore += 60;
    }
    if (AML_DAILY_TOPUP_LIMIT > 0 && aml.dailyTopUpTotal + amount > AML_DAILY_TOPUP_LIMIT) {
      flags.push("aml_daily_topup_limit");
      riskScore += 70;
    }
    if (
      AML_TOPUP_BURST_COUNT > 0 &&
      aml.recentTopUpCount >= AML_TOPUP_BURST_COUNT
    ) {
      flags.push("aml_topup_velocity");
      riskScore += 45;
    }
    if (
      AML_STRUCTURING_COUNT > 0 &&
      amount > 0 &&
      amount < AML_STRUCTURING_THRESHOLD &&
      aml.recentSubThresholdCount + 1 >= AML_STRUCTURING_COUNT
    ) {
      flags.push("aml_structuring_pattern");
      riskScore += 50;
    }
  }

  const hasAmlFlag = flags.some((flag) => flag.startsWith("aml_"));
  const shouldBlockAml = hasAmlFlag && AML_BLOCK_ON_SUSPICIOUS;

  const action =
    shouldBlockAml || (riskScore >= 70 && BLOCK_ON_RISK)
      ? "block"
      : riskScore >= 40
      ? "review"
      : "allow";
  const severity = action === "block" ? "high" : action === "review" ? "medium" : "low";
  const ruleCode = flags[0] || "ok";

  await pool.query(
    `INSERT INTO fraud_events (user_id, payment_id, rule_code, severity, details)
     VALUES (?, NULL, ?, ?, ?)`,
    [
      userId || null,
      ruleCode,
      severity,
      JSON.stringify({ action, riskScore, flags, ipAddress, amount, aml }),
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
