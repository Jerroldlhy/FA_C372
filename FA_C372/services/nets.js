const requestNetsQr = async (amount) => {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available.");
  }
  if (!process.env.API_KEY || !process.env.PROJECT_ID) {
    throw new Error("Missing NETS API configuration.");
  }

  const response = await fetch(
    "https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/request",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.API_KEY,
        "project-id": process.env.PROJECT_ID,
      },
      body: JSON.stringify({
        txn_id: `fa_c372_${Date.now()}`,
        amt_in_dollars: Number(amount).toFixed(2),
        notify_mobile: 1,
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "NETS QR request failed.");
  }
  return data;
};

const queryNetsQr = async (txnRetrievalRef) => {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available.");
  }

  const response = await fetch(
    "https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/query",
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

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "NETS QR query failed.");
  }
  return data;
};

module.exports = {
  requestNetsQr,
  queryNetsQr,
};
