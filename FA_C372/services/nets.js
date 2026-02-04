const safeJsonParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const requestNetsQr = async (amount) => {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available.");
  }
  if (!process.env.API_KEY || !process.env.PROJECT_ID) {
    throw new Error("Missing NETS API configuration.");
  }

  const txnId = String(
    process.env.NETS_TXN_ID || "sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b"
  ).trim();
  const numericAmount = Number(Number(amount || 0).toFixed(2));
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("Invalid NETS amount.");
  }

  const response = await fetch(
    process.env.NETS_REQUEST_URL || "https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/request",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.API_KEY,
        "project-id": process.env.PROJECT_ID,
      },
      body: JSON.stringify({
        txn_id: txnId,
        amt_in_dollars: numericAmount,
        notify_mobile: 1,
      }),
    }
  );

  const raw = await response.text();
  const data = safeJsonParse(raw);
  if (!response.ok) {
    const details =
      data?.message ||
      data?.error ||
      data?.result?.message ||
      data?.result?.status_desc ||
      (raw ? raw.slice(0, 300) : "");
    throw new Error(`NETS QR request failed (${response.status}): ${details || "Unknown error"}`);
  }
  if (!data) {
    throw new Error("NETS QR request failed: invalid JSON response from provider.");
  }
  return data;
};

const queryNetsQr = async (txnRetrievalRef) => {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available.");
  }

  const response = await fetch(
    process.env.NETS_QUERY_URL || "https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/query",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.API_KEY,
        "project-id": process.env.PROJECT_ID,
      },
      body: JSON.stringify({
        txn_retrieval_ref: txnRetrievalRef,
      }),
    }
  );

  const raw = await response.text();
  const data = safeJsonParse(raw);
  if (!response.ok) {
    const details =
      data?.message ||
      data?.error ||
      data?.result?.message ||
      data?.result?.status_desc ||
      (raw ? raw.slice(0, 300) : "");
    throw new Error(`NETS QR query failed (${response.status}): ${details || "Unknown error"}`);
  }
  if (!data) {
    throw new Error("NETS QR query failed: invalid JSON response from provider.");
  }
  return data;
};

module.exports = {
  requestNetsQr,
  queryNetsQr,
};
