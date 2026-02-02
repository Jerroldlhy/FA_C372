const parsePositiveAmount = (rawAmount) => {
  const amount = Number(rawAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return amount;
};

const normalizePaymentMethod = (method) => {
  const value = String(method || "paypal").toLowerCase();
  if (["paypal", "mobile", "bank_transfer"].includes(value)) {
    return value;
  }
  return null;
};

module.exports = {
  parsePositiveAmount,
  normalizePaymentMethod,
};
