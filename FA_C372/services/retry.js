const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withRetries = async (fn, options = {}) => {
  const retries = Number.isFinite(Number(options.retries)) ? Number(options.retries) : 2;
  const baseDelayMs = Number.isFinite(Number(options.baseDelayMs))
    ? Number(options.baseDelayMs)
    : 250;

  let lastError;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i === retries) break;
      await sleep(baseDelayMs * Math.pow(2, i));
    }
  }
  throw lastError;
};

module.exports = { withRetries };
