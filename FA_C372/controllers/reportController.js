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
  getFraudAuditRows,
  buildFraudAuditSummary,
} = require("../models/reportModel");
const { getAuditLogRows, getDistinctActivityTypes, logUserActivity } = require("../models/userActivityModel");

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

const normaliseSeverity = (value) => {
  const severity = String(value || "").trim().toLowerCase();
  if (!severity) return "";
  return ["low", "medium", "high"].includes(severity) ? severity : null;
};

const parseDetails = (input) => {
  if (!input) return null;
  if (typeof input === "object") return input;
  try {
    return JSON.parse(String(input));
  } catch (err) {
    return null;
  }
};

const buildAuditSummary = (rows = []) => {
  const activityCounts = new Map();
  const userSet = new Set();
  const actorSet = new Set();
  rows.forEach((row) => {
    const type = String(row.activity_type || "unknown");
    activityCounts.set(type, Number(activityCounts.get(type) || 0) + 1);
    if (Number(row.user_id) > 0) userSet.add(Number(row.user_id));
    if (Number(row.actor_user_id) > 0) actorSet.add(Number(row.actor_user_id));
  });
  return {
    totalEvents: Number(rows.length || 0),
    affectedUsers: userSet.size,
    actors: actorSet.size,
    topActivities: [...activityCounts.entries()]
      .map(([activityType, total]) => ({ activityType, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10),
  };
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

const showFraudAuditReport = async (req, res, next) => {
  try {
    const range = normaliseDateRange(req.query);
    if (range.error) {
      return res.redirect(`/dashboard/admin?report_error=${encodeURIComponent(range.error)}`);
    }
    const severity = normaliseSeverity(req.query.severity);
    if (severity === null) {
      return res.redirect("/dashboard/admin?report_error=invalid_severity");
    }

    const rows = await getFraudAuditRows({
      fromDate: range.fromDate,
      toDate: range.toDate,
      severity,
    });
    const reportRows = rows.map((row) => ({
      ...row,
      details: parseDetails(row.details),
    }));
    const summary = buildFraudAuditSummary(reportRows);

    return res.render("adminFraudReport", {
      report: reportRows,
      summary,
      filters: {
        from: range.fromDate,
        to: range.toDate,
        severity,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const exportFraudAuditReport = async (req, res, next) => {
  try {
    const format = String(req.query.format || "csv").toLowerCase();
    const range = normaliseDateRange(req.query);
    if (range.error) {
      return res.redirect(`/dashboard/admin?report_error=${encodeURIComponent(range.error)}`);
    }
    const severity = normaliseSeverity(req.query.severity);
    if (severity === null) {
      return res.redirect("/dashboard/admin?report_error=invalid_severity");
    }

    const rows = await getFraudAuditRows({
      fromDate: range.fromDate,
      toDate: range.toDate,
      severity,
    });
    const reportRows = rows.map((row) => ({
      ...row,
      details: parseDetails(row.details),
    }));
    const summary = buildFraudAuditSummary(reportRows);
    const fromLabel = range.fromDate || "all";
    const toLabel = range.toDate || "all";
    const severityLabel = severity || "all";
    const stamp = `${fromLabel}_to_${toLabel}_${severityLabel}`.replace(/[^a-zA-Z0-9_-]/g, "-");

    if (format === "csv") {
      const lines = [];
      lines.push("Fraud Audit Report");
      lines.push(`From,${csvEscape(fromLabel)}`);
      lines.push(`To,${csvEscape(toLabel)}`);
      lines.push(`Severity,${csvEscape(severityLabel)}`);
      lines.push(`Total Events,${summary.totalEvents}`);
      lines.push(`High Severity,${summary.high}`);
      lines.push(`Medium Severity,${summary.medium}`);
      lines.push(`Low Severity,${summary.low}`);
      lines.push("");
      lines.push("Event ID,Timestamp,User ID,User Name,User Email,Rule Code,Severity,Risk Score,Flags,Amount,Action,IP Address");

      reportRows.forEach((row) => {
        const details = row.details || {};
        const flags = Array.isArray(details.flags) ? details.flags.join("|") : "";
        lines.push(
          [
            row.id,
            row.created_at ? new Date(row.created_at).toISOString() : "",
            row.user_id || "",
            csvEscape(row.user_name || ""),
            csvEscape(row.user_email || ""),
            csvEscape(row.rule_code || ""),
            csvEscape(row.severity || ""),
            Number(details.riskScore || 0),
            csvEscape(flags),
            Number(details.amount || 0),
            csvEscape(details.action || ""),
            csvEscape(details.ipAddress || ""),
          ].join(",")
        );
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="fraud-audit-${stamp}.csv"`);
      return res.send(lines.join("\n"));
    }

    if (format === "pdf") {
      if (!PDFDocument) {
        return res.redirect("/dashboard/admin?report_error=pdfkit_missing");
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="fraud-audit-${stamp}.pdf"`);

      const doc = new PDFDocument({ size: "A4", margin: 40 });
      doc.pipe(res);

      doc.fontSize(18).text("Fraud Audit Report", { align: "left" });
      doc.moveDown(0.4);
      doc.fontSize(11).text(`From: ${fromLabel}`);
      doc.text(`To: ${toLabel}`);
      doc.text(`Severity: ${severityLabel}`);
      doc.text(`Total Events: ${summary.totalEvents}`);
      doc.text(`High: ${summary.high} | Medium: ${summary.medium} | Low: ${summary.low}`);
      doc.moveDown(0.8);
      doc.fontSize(12).text("Top Triggered Rules", { underline: true });
      doc.moveDown(0.3);
      if (!summary.topRules.length) {
        doc.fontSize(10).text("No rule events for selected filters.");
      } else {
        summary.topRules.forEach((item, index) => {
          doc.fontSize(10).text(`${index + 1}. ${item.ruleCode} | ${item.total} events`);
        });
      }

      doc.moveDown(0.8);
      doc.fontSize(12).text("Recent Events", { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(9);
      reportRows.slice(0, 120).forEach((row) => {
        const details = row.details || {};
        const flags = Array.isArray(details.flags) ? details.flags.join("|") : "";
        const line = `#${row.id} ${row.created_at ? new Date(row.created_at).toISOString().slice(0, 19).replace("T", " ") : ""} | ${row.user_email || "unknown"} | ${row.rule_code} | ${row.severity} | ${flags}`;
        doc.text(line);
      });
      if (reportRows.length > 120) {
        doc.moveDown(0.3);
        doc.text(`... ${reportRows.length - 120} additional events omitted in PDF output.`);
      }

      doc.end();
      return;
    }

    return res.redirect("/dashboard/admin?report_error=invalid_format");
  } catch (err) {
    return next(err);
  }
};

const showAuditLogReport = async (req, res, next) => {
  try {
    const range = normaliseDateRange(req.query);
    if (range.error) {
      return res.redirect(`/dashboard/admin?report_error=${encodeURIComponent(range.error)}`);
    }
    const activityType = String(req.query.activity_type || "").trim();
    const userId = Number(req.query.user_id || 0) || null;
    const actorUserId = Number(req.query.actor_user_id || 0) || null;

    const [rows, activityTypes] = await Promise.all([
      getAuditLogRows({
        fromDate: range.fromDate,
        toDate: range.toDate,
        activityType,
        userId,
        actorUserId,
      }),
      getDistinctActivityTypes(),
    ]);

    const reportRows = rows.map((row) => ({ ...row, details: parseDetails(row.details) }));
    const summary = buildAuditSummary(reportRows);

    await logUserActivity({
      userId: req.user.id,
      actorUserId: req.user.id,
      activityType: "audit_log_viewed",
      ipAddress: req.ip,
      details: { from: range.fromDate || null, to: range.toDate || null, activityType: activityType || null },
    }).catch(() => null);

    return res.render("adminAuditLog", {
      report: reportRows,
      summary,
      activityTypes,
      filters: {
        from: range.fromDate,
        to: range.toDate,
        activityType,
        userId: userId || "",
        actorUserId: actorUserId || "",
      },
    });
  } catch (err) {
    return next(err);
  }
};

const exportAuditLogReport = async (req, res, next) => {
  try {
    const format = String(req.query.format || "csv").toLowerCase();
    const range = normaliseDateRange(req.query);
    if (range.error) {
      return res.redirect(`/dashboard/admin?report_error=${encodeURIComponent(range.error)}`);
    }
    const activityType = String(req.query.activity_type || "").trim();
    const userId = Number(req.query.user_id || 0) || null;
    const actorUserId = Number(req.query.actor_user_id || 0) || null;

    const rows = await getAuditLogRows({
      fromDate: range.fromDate,
      toDate: range.toDate,
      activityType,
      userId,
      actorUserId,
    });
    const reportRows = rows.map((row) => ({ ...row, details: parseDetails(row.details) }));
    const summary = buildAuditSummary(reportRows);

    const fromLabel = range.fromDate || "all";
    const toLabel = range.toDate || "all";
    const activityLabel = activityType || "all";
    const stamp = `${fromLabel}_to_${toLabel}_${activityLabel}`.replace(/[^a-zA-Z0-9_-]/g, "-");

    await logUserActivity({
      userId: req.user.id,
      actorUserId: req.user.id,
      activityType: "audit_log_exported",
      ipAddress: req.ip,
      details: { format, from: range.fromDate || null, to: range.toDate || null, activityType: activityType || null },
    }).catch(() => null);

    if (format === "csv") {
      const lines = [];
      lines.push("Audit Log Report");
      lines.push(`From,${csvEscape(fromLabel)}`);
      lines.push(`To,${csvEscape(toLabel)}`);
      lines.push(`Activity Type,${csvEscape(activityLabel)}`);
      lines.push(`Total Events,${summary.totalEvents}`);
      lines.push(`Affected Users,${summary.affectedUsers}`);
      lines.push(`Actors,${summary.actors}`);
      lines.push("");
      lines.push("Event ID,Timestamp,User ID,User Name,User Email,Actor ID,Actor Name,Actor Email,Activity Type,IP Address,Details");

      reportRows.forEach((row) => {
        lines.push(
          [
            row.id,
            row.created_at ? new Date(row.created_at).toISOString() : "",
            row.user_id || "",
            csvEscape(row.user_name || ""),
            csvEscape(row.user_email || ""),
            row.actor_user_id || "",
            csvEscape(row.actor_name || ""),
            csvEscape(row.actor_email || ""),
            csvEscape(row.activity_type || ""),
            csvEscape(row.ip_address || ""),
            csvEscape(row.details ? JSON.stringify(row.details) : ""),
          ].join(",")
        );
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="audit-log-${stamp}.csv"`);
      return res.send(lines.join("\n"));
    }

    if (format === "pdf") {
      if (!PDFDocument) return res.redirect("/dashboard/admin?report_error=pdfkit_missing");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="audit-log-${stamp}.pdf"`);

      const doc = new PDFDocument({ size: "A4", margin: 40 });
      doc.pipe(res);
      doc.fontSize(18).text("Audit Log Report", { align: "left" });
      doc.moveDown(0.4);
      doc.fontSize(11).text(`From: ${fromLabel}`);
      doc.text(`To: ${toLabel}`);
      doc.text(`Activity Type: ${activityLabel}`);
      doc.text(`Total Events: ${summary.totalEvents}`);
      doc.text(`Affected Users: ${summary.affectedUsers} | Actors: ${summary.actors}`);
      doc.moveDown(0.8);
      doc.fontSize(12).text("Top Activities", { underline: true });
      doc.moveDown(0.3);
      if (!summary.topActivities.length) {
        doc.fontSize(10).text("No activity events for selected filters.");
      } else {
        summary.topActivities.forEach((item, index) => {
          doc.fontSize(10).text(`${index + 1}. ${item.activityType} | ${item.total} events`);
        });
      }
      doc.moveDown(0.8);
      doc.fontSize(12).text("Recent Events", { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(9);
      reportRows.slice(0, 140).forEach((row) => {
        const line = `#${row.id} ${row.created_at ? new Date(row.created_at).toISOString().replace("T", " ").slice(0, 19) : ""} | user:${row.user_id || "-"} | actor:${row.actor_user_id || "-"} | ${row.activity_type}`;
        doc.text(line);
      });
      if (reportRows.length > 140) {
        doc.moveDown(0.3);
        doc.text(`... ${reportRows.length - 140} additional events omitted in PDF output.`);
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
  showFraudAuditReport,
  exportFraudAuditReport,
  showAuditLogReport,
  exportAuditLogReport,
};
