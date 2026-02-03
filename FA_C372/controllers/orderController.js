const {
  CheckoutError,
  createOrderFromCart,
  getOrdersByUser,
  getOrderByIdForUser,
} = require("../models/orderModel");

const checkout = async (req, res, next) => {
  try {
    const paymentMethod = (req.body.payment_method || "wallet").toLowerCase();
    const externalMethods = new Set(["paypal", "stripe", "nets"]);
    if (externalMethods.has(paymentMethod)) {
      const sessionPayment = req.session?.payment || null;
      if (!sessionPayment || String(sessionPayment.method || "").toLowerCase() !== paymentMethod) {
        return res.redirect(`/cart?checkout_error=${encodeURIComponent("payment_required")}`);
      }
    }

    const result = await createOrderFromCart(req.user.id, paymentMethod);
    if (req.session) {
      req.session.payment = null;
      req.session.netsTxnRetrievalRef = null;
    }
    res.redirect(`/orders/${result.orderId}?ordered=1`);
  } catch (err) {
    if (err instanceof CheckoutError) {
      return res.redirect(`/cart?checkout_error=${encodeURIComponent(err.code)}`);
    }
    next(err);
  }
};

const listMyOrders = async (req, res, next) => {
  try {
    const orders = await getOrdersByUser(req.user.id);
    res.render("orders", { orders, status: req.query });
  } catch (err) {
    next(err);
  }
};

const getMyOrderDetails = async (req, res, next) => {
  try {
    const order = await getOrderByIdForUser(req.params.id, req.user.id);
    if (!order) return res.status(404).render("404");
    res.render("orderDetails", { order, status: req.query });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  checkout,
  listMyOrders,
  getMyOrderDetails,
};
