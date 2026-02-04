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

    const download = String(req.query.download || "").toLowerCase();
    if (download === "receipt") {
      const lines = [];
      lines.push(`EduSphere Receipt`);
      lines.push(`Order ID: ${order.id}`);
      lines.push(`Date: ${order.created_at ? new Date(order.created_at).toISOString() : ""}`);
      lines.push(`Payment Status: ${order.payment_status}`);
      lines.push(`Order Status: ${order.order_status}`);
      lines.push("");
      lines.push("Items:");
      (order.items || []).forEach((item) => {
        const qty = Number(item.quantity || 1);
        const unit = Number(item.unit_price || 0);
        const total = (qty * unit).toFixed(2);
        lines.push(`- ${item.course_name} | qty ${qty} | $${unit.toFixed(2)} | line $${total}`);
      });
      lines.push("");
      lines.push(`Total: $${Number(order.total_amount || 0).toFixed(2)}`);

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"receipt-order-${order.id}.txt\"`);
      return res.send(lines.join("\n"));
    }

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
