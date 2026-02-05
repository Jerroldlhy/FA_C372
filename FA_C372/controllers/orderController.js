const {
  CheckoutError,
  createOrderFromCart,
  getOrdersByUser,
  getOrderByIdForUser,
} = require("../models/orderModel");
const { getCartItemsForUser } = require("../models/cartModel");
const { getSubscriptionByUser } = require("../models/subscriptionModel");
let PDFDocument = null;
try {
  PDFDocument = require("pdfkit");
} catch (err) {
  PDFDocument = null;
}

const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;

const formatTimestamp = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const toTitleCase = (value) =>
  String(value || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "-";

const truncateText = (value, maxLength = 44) => {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
};

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

    const items = await getCartItemsForUser(req.user.id);
    const hasProCourse = items.some(
      (item) => String(item.subscription_model || "free").toLowerCase() === "pro"
    );
    if (hasProCourse) {
      const subscription = await getSubscriptionByUser(req.user.id);
      const hasAccess =
        subscription &&
        String(subscription.plan_code || "").toLowerCase() === "pro" &&
        String(subscription.status || "").toLowerCase() === "active";
      if (!hasAccess) {
        return res.redirect(`/cart?checkout_error=${encodeURIComponent("pro_required")}`);
      }
    }

    const result = await createOrderFromCart(req.user.id, paymentMethod, {
      providerTxnId: req.session?.payment?.captureId || null,
    });
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
    if (download === "invoice") {
      if (!PDFDocument) {
        return res.redirect(`/orders/${order.id}?invoice_error=pdf_unavailable`);
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="invoice-order-${order.id}.pdf"`);

      const doc = new PDFDocument({ size: "A4", margin: 40 });
      doc.pipe(res);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const pageWidth = right - left;
      const issuedAt = formatTimestamp(order.created_at);
      const items = order.items || [];
      const refundedAmount = Number(order.refunded_amount || 0);
      const subtotal = items.reduce((sum, item) => {
        const qty = Number(item.quantity || 1);
        const unit = Number(item.unit_price || 0);
        return sum + qty * unit;
      }, 0);
      const totalPaid = Number(order.total_amount || 0);
      const netAmount = Math.max(totalPaid - refundedAmount, 0);

      const bannerY = doc.y;
      doc.save();
      doc.roundedRect(left, bannerY, pageWidth, 64, 8).fill("#eef2ff");
      doc.restore();
      doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(20).text("EduSphere", left + 14, bannerY + 16);
      doc.font("Helvetica").fontSize(11).fillColor("#4b5563").text("Invoice", right - 90, bannerY + 23, {
        width: 76,
        align: "right",
      });
      doc.y = bannerY + 82;

      doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(`Invoice #: INV-${order.id}`, left, doc.y);
      doc.font("Helvetica").fontSize(10).fillColor("#4b5563");
      doc.text(`Order ID: ${order.id}`);
      doc.text(`Issued: ${issuedAt}`);
      doc.text(`Payment Status: ${toTitleCase(order.payment_status)}`);
      doc.text(`Order Status: ${toTitleCase(order.order_status)}`);

      doc.moveDown(0.6);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827").text("Billed To");
      doc.font("Helvetica").fontSize(10).fillColor("#4b5563");
      doc.text(req.user?.name || "Student");
      if (req.user?.email) {
        doc.text(req.user.email);
      }

      doc.moveDown(0.8);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor("#e5e7eb").lineWidth(1).stroke();
      doc.moveDown(0.8);

      const drawTableHeader = (y) => {
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#6b7280");
        doc.text("Course", left, y, { width: 280, lineBreak: false });
        doc.text("Qty", left + 288, y, { width: 40, align: "center", lineBreak: false });
        doc.text("Unit", left + 338, y, { width: 72, align: "right", lineBreak: false });
        doc.text("Line Total", left + 420, y, { width: 95, align: "right" });
        doc.moveTo(left, y + 16).lineTo(right, y + 16).strokeColor("#e5e7eb").lineWidth(1).stroke();
        return y + 22;
      };

      let rowY = drawTableHeader(doc.y);
      doc.font("Helvetica").fontSize(10).fillColor("#111827");

      if (!items.length) {
        doc.text("No items recorded for this order.", left, rowY + 4);
        rowY += 24;
      } else {
        items.forEach((item) => {
          if (rowY > doc.page.height - doc.page.margins.bottom - 120) {
            doc.addPage();
            rowY = drawTableHeader(doc.page.margins.top);
            doc.font("Helvetica").fontSize(10).fillColor("#111827");
          }
          const qty = Number(item.quantity || 1);
          const unit = Number(item.unit_price || 0);
          const lineTotal = qty * unit;

          doc.text(truncateText(item.course_name, 52), left, rowY, { width: 280, lineBreak: false });
          doc.text(String(qty), left + 288, rowY, { width: 40, align: "center", lineBreak: false });
          doc.text(formatMoney(unit), left + 338, rowY, { width: 72, align: "right", lineBreak: false });
          doc.text(formatMoney(lineTotal), left + 420, rowY, { width: 95, align: "right" });
          rowY += 18;
        });
      }

      if (rowY > doc.page.height - doc.page.margins.bottom - 110) {
        doc.addPage();
        rowY = doc.page.margins.top + 4;
      }

      const summaryX = right - 210;
      const summaryY = rowY + 12;
      doc.save();
      doc.roundedRect(summaryX, summaryY, 210, 84, 8).fill("#f8fafc");
      doc.restore();

      doc.font("Helvetica").fontSize(10).fillColor("#6b7280");
      doc.text("Subtotal", summaryX + 12, summaryY + 14, { width: 96 });
      doc.text(formatMoney(subtotal), summaryX + 108, summaryY + 14, { width: 90, align: "right" });
      doc.text("Refunded", summaryX + 12, summaryY + 34, { width: 96 });
      doc.text(formatMoney(refundedAmount), summaryX + 108, summaryY + 34, { width: 90, align: "right" });
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
      doc.text("Total Paid", summaryX + 12, summaryY + 56, { width: 96 });
      doc.text(formatMoney(netAmount), summaryX + 108, summaryY + 56, { width: 90, align: "right" });

      const footerY = doc.page.height - doc.page.margins.bottom - 12;
      doc.font("Helvetica").fontSize(9).fillColor("#6b7280").text(
        "This invoice is system-generated by EduSphere and valid without signature.",
        left,
        footerY,
        { width: pageWidth }
      );
      doc.end();
      return;
    }

    if (download === "receipt") {
      const lines = [];
      lines.push(`EduSphere Receipt`);
      lines.push(`Order ID: ${order.id}`);
      lines.push(`Date: ${formatTimestamp(order.created_at)}`);
      lines.push(`Payment Status: ${order.payment_status}`);
      lines.push(`Order Status: ${order.order_status}`);
      lines.push("");
      lines.push("Items:");
      (order.items || []).forEach((item) => {
        const qty = Number(item.quantity || 1);
        const unit = Number(item.unit_price || 0);
        const lineTotal = qty * unit;
        lines.push(`- ${item.course_name} | qty ${qty} | ${formatMoney(unit)} | line ${formatMoney(lineTotal)}`);
      });
      lines.push("");
      lines.push(`Total: ${formatMoney(order.total_amount)}`);

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
