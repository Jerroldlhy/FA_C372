const DEFAULT_CURRENCY = (process.env.DEFAULT_CURRENCY || "USD").toUpperCase();

const SUPPORTED_CURRENCIES = (process.env.SUPPORTED_CURRENCIES || "USD,SGD,MYR,EUR,GBP")
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);

const CURRENCY_SYMBOLS = {
  USD: "$",
  SGD: "S$",
  MYR: "RM",
  EUR: "EUR ",
  GBP: "GBP ",
};

const loadRates = () => {
  if (!process.env.EXCHANGE_RATES) return {};
  try {
    const parsed = JSON.parse(process.env.EXCHANGE_RATES);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
};

const rateTable = loadRates();

const normaliseCurrency = (code) => {
  const value = String(code || "").trim().toUpperCase();
  if (!value) return DEFAULT_CURRENCY;
  return SUPPORTED_CURRENCIES.includes(value) ? value : DEFAULT_CURRENCY;
};

const getSymbol = (code) => CURRENCY_SYMBOLS[normaliseCurrency(code)] || "";

const getExchangeRate = (fromCurrency, toCurrency) => {
  const from = normaliseCurrency(fromCurrency);
  const to = normaliseCurrency(toCurrency);
  if (from === to) return 1;
  const rate = Number((rateTable[from] || {})[to]);
  if (Number.isFinite(rate) && rate > 0) return rate;
  return 1;
};

const convertAmount = (amount, fromCurrency, toCurrency) => {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  const rate = getExchangeRate(fromCurrency, toCurrency);
  return Number((value * rate).toFixed(2));
};

module.exports = {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  normaliseCurrency,
  getSymbol,
  getExchangeRate,
  convertAmount,
};
