const PAYPAL_CLIENT = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API = process.env.PAYPAL_API;

const tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

const getAccessToken = async () => {
  if (!PAYPAL_CLIENT || !PAYPAL_SECRET || !PAYPAL_API) {
    throw new Error("Missing PayPal configuration.");
  }

  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available.");
  }

  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${PAYPAL_CLIENT}:${PAYPAL_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json();
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || "Unable to get PayPal token.");
  }

  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAt = Date.now() + (Number(data.expires_in || 3600) * 1000 - 60 * 1000);
  return tokenCache.accessToken;
};

const createOrder = async (amount, options = {}) => {
  const accessToken = await getAccessToken();
  const currencyCode = options.currencyCode || "USD";
  const invoiceNumber = options.invoiceNumber || undefined;
  const customId = options.customId || undefined;

  const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: currencyCode, value: String(amount) },
          invoice_id: invoiceNumber,
          custom_id: customId,
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Failed to create PayPal order.");
  }
  return data;
};

const captureOrder = async (orderId) => {
  const accessToken = await getAccessToken();
  const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Failed to capture PayPal order.");
  }
  return data;
};

const refundCapture = async (captureId) => {
  const accessToken = await getAccessToken();
  const response = await fetch(`${PAYPAL_API}/v2/payments/captures/${captureId}/refund`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || data?.details?.[0]?.description || "Failed to refund PayPal capture.");
  }
  return data;
};

module.exports = {
  createOrder,
  captureOrder,
  refundCapture,
};
