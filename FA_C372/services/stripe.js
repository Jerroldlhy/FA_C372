let StripeCtor = null;
try {
  // Optional dependency. If missing, endpoint returns a clear error.
  StripeCtor = require("stripe");
} catch (err) {
  StripeCtor = null;
}

let cachedStripe = null;

const getStripe = () => {
  if (!StripeCtor) return null;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  if (!cachedStripe) {
    cachedStripe = new StripeCtor(secret);
  }
  return cachedStripe;
};

const createCheckoutSession = async (data = {}) => {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured. Install stripe and set STRIPE_SECRET_KEY.");
  }

  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid Stripe amount.");
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: String(data.currency || "usd").toLowerCase(),
          unit_amount: Math.round(amount * 100),
          product_data: {
            name: data.description || "Course checkout",
          },
        },
        quantity: 1,
      },
    ],
    success_url: data.successUrl,
    cancel_url: data.cancelUrl,
    customer_email: data.customerEmail || undefined,
    client_reference_id: data.clientReferenceId || undefined,
    metadata: data.metadata || undefined,
  });

  return session;
};

const retrieveCheckoutSession = async (sessionId) => {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured.");
  }
  return stripe.checkout.sessions.retrieve(sessionId);
};

module.exports = {
  createCheckoutSession,
  retrieveCheckoutSession,
};
