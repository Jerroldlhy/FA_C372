let PDFDocument = null;
try {
  PDFDocument = require("pdfkit");
} catch (err) {
  PDFDocument = null;
}

const {
  DATE_PATTERN,
  getSalesReportRows,
  buildSalesSummary,
} = require("../models/reportModel");

const asDateInput = (value) => String(value || "").trim();

const normaliseDateRange = (query = {}) => {
  const fromDate = asDateInput(query.from);
  const toDate = asDateInput(query.to);

  if (fromDate && !DATE_PATTERN.test(fromDate)) {
    return { error: "invalid_from_date" };
  }
  if (toDate && !DATE_PATTERN.test(toDate)) {
    return { error: "invalid_to_date" };
  }
  if (fromDate && toDate && fromDate > toDate) {
    return { error: "invalid_date_range" };
  }
  return { fromDate, toDate, error: null };
};

const csvEscape = (value) => {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const showSalesReport = async (req, res, next) => {
  try {
    const range = normaliseDateRange(req.query);
    if (range.error) {
      return res.redirect(`/dashboard/admin?report_error=${encodeURIComponent(range.error)}`);
    }

    const rows = await getSalesReportRows({
      fromDate: range.fromDate,
      toDate: range.toDate,
    });
    const summary = buildSalesSummary(rows);

    return res.render("adminSalesReport", {
      report: rows,
      summary,
      filters: {
        from: range.fromDate,
        to: range.toDate,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const exportSalesReport = async (req, res, next) => {
  try {
    const format = String(req.query.format || "csv").toLowerCase();
    const range = normaliseDateRange(req.query);
    if (range.error) {
      return res.redirect(`/dashboard/admin?report_error=${encodeURIComponent(range.error)}`);
    }

    const rows = await getSalesReportRows({
      fromDate: range.fromDate,
      toDate: range.toDate,
    });
    const summary = buildSalesSummary(rows);
    const fromLabel = range.fromDate || "all";
    const toLabel = range.toDate || "all";
    const stamp = `${fromLabel}_to_${toLabel}`.replace(/[^a-zA-Z0-9_-]/g, "-");

    if (format === "csv") {
      const lines = [];
      lines.push("Sales Report");
      lines.push(`From,${csvEscape(fromLabel)}`);
      lines.push(`To,${csvEscape(toLabel)}`);
      lines.push(`Total Orders,${summary.totalOrders}`);
      lines.push(`Total Items,${summary.totalItems}`);
      lines.push(`Total Revenue (USD),${summary.totalRevenue.toFixed(2)}`);
      lines.push("");
      lines.push("Order ID,Date,User ID,User Name,User Email,Course ID,Course Name,Quantity,Unit Price,Line Total");

      rows.forEach((row) => {
        lines.push(
          [
            row.order_id,
            row.created_at ? new Date(row.created_at).toISOString() : "",
            row.user_id,
            csvEscape(row.user_name),
            csvEscape(row.user_email),
            row.course_id,
            csvEscape(row.course_name),
            Number(row.quantity || 0),
            Number(row.unit_price || 0).toFixed(2),
            Number(row.line_total || 0).toFixed(2),
          ].join(",")
        );
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="sales-report-${stamp}.csv"`);
      return res.send(lines.join("\n"));
    }

    if (format === "pdf") {
      if (!PDFDocument) {
        return res.redirect("/dashboard/admin?report_error=pdfkit_missing");
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="sales-report-${stamp}.pdf"`);

      const doc = new PDFDocument({ size: "A4", margin: 40 });
      doc.pipe(res);

      doc.fontSize(18).text("Sales Report", { align: "left" });
      doc.moveDown(0.4);
      doc.fontSize(11).text(`From: ${fromLabel}`);
      doc.text(`To: ${toLabel}`);
      doc.text(`Total Orders: ${summary.totalOrders}`);
      doc.text(`Total Items: ${summary.totalItems}`);
      doc.text(`Total Revenue (USD): $${summary.totalRevenue.toFixed(2)}`);
      doc.moveDown(0.8);
      doc.fontSize(12).text("Top Courses", { underline: true });
      doc.moveDown(0.3);

      if (!summary.topCourses.length) {
        doc.fontSize(10).text("No sales data for selected range.");
      } else {
        summary.topCourses.forEach((item, index) => {
          doc
            .fontSize(10)
            .text(
              `${index + 1}. ${item.courseName} | Qty ${item.quantity} | $${Number(item.revenue || 0).toFixed(2)}`
            );
        });
      }

      doc.moveDown(0.8);
      doc.fontSize(12).text("Transactions", { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(9);
      rows.slice(0, 120).forEach((row) => {
        const line = `#${row.order_id} ${row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : ""} | ${row.user_name} | ${row.course_name} | qty ${row.quantity} | $${Number(row.line_total || 0).toFixed(2)}`;
        doc.text(line);
      });
      if (rows.length > 120) {
        doc.moveDown(0.3);
        doc.text(`... ${rows.length - 120} additional line items omitted in PDF output.`);
      }

      doc.end();
      return;
    }

    return res.redirect("/dashboard/admin?report_error=invalid_format");
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  showSalesReport,
  exportSalesReport,
};

