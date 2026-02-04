const pool = require("./db");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidDateInput = (value) => DATE_PATTERN.test(String(value || "").trim());

const toDateRange = (fromDate, toDate) => {
  const where = ["o.payment_status = 'paid'"];
  const params = [];

  if (isValidDateInput(fromDate)) {
    where.push("o.created_at >= ?");
    params.push(String(fromDate).trim());
  }

  if (isValidDateInput(toDate)) {
    where.push("o.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(String(toDate).trim());
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
};

const getSalesReportRows = async ({ fromDate, toDate } = {}) => {
  const { whereSql, params } = toDateRange(fromDate, toDate);
  const [rows] = await pool.query(
    `SELECT
       o.id AS order_id,
       o.created_at,
       u.id AS user_id,
       u.name AS user_name,
       u.email AS user_email,
       oi.course_id,
       c.course_name,
       oi.quantity,
       oi.unit_price,
       (oi.quantity * oi.unit_price) AS line_total
     FROM orders o
     JOIN users u ON u.id = o.user_id
     JOIN order_items oi ON oi.order_id = o.id
     JOIN courses c ON c.id = oi.course_id
     ${whereSql}
     ORDER BY o.created_at DESC, o.id DESC, oi.id ASC`,
    params
  );
  return rows;
};

const buildSalesSummary = (rows = []) => {
  const orderSet = new Set();
  let totalRevenue = 0;
  let totalItems = 0;
  const byCourse = new Map();

  rows.forEach((row) => {
    orderSet.add(Number(row.order_id));
    const qty = Number(row.quantity || 0);
    const lineTotal = Number(row.line_total || 0);
    totalItems += qty;
    totalRevenue += lineTotal;

    const key = Number(row.course_id);
    if (!byCourse.has(key)) {
      byCourse.set(key, {
        courseId: key,
        courseName: row.course_name || "Untitled course",
        quantity: 0,
        revenue: 0,
      });
    }
    const item = byCourse.get(key);
    item.quantity += qty;
    item.revenue += lineTotal;
  });

  const topCourses = [...byCourse.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return {
    totalOrders: orderSet.size,
    totalItems,
    totalRevenue: Number(totalRevenue.toFixed(2)),
    topCourses,
  };
};

const getFraudAuditRows = async ({ fromDate, toDate, severity } = {}) => {
  const where = [];
  const params = [];
  if (isValidDateInput(fromDate)) {
    where.push("fe.created_at >= ?");
    params.push(String(fromDate).trim());
  }
  if (isValidDateInput(toDate)) {
    where.push("fe.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(String(toDate).trim());
  }

  const severityValue = String(severity || "").toLowerCase();
  if (severityValue && ["low", "medium", "high"].includes(severityValue)) {
    where.push("fe.severity = ?");
    params.push(severityValue);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `SELECT
       fe.id,
       fe.created_at,
       fe.user_id,
       u.name AS user_name,
       u.email AS user_email,
       fe.rule_code,
       fe.severity,
       fe.details
     FROM fraud_events fe
     LEFT JOIN users u ON u.id = fe.user_id
     ${whereSql}
     ORDER BY fe.created_at DESC, fe.id DESC`,
    params
  );
  return rows;
};

const buildFraudAuditSummary = (rows = []) => {
  const summary = {
    totalEvents: Number(rows.length || 0),
    low: 0,
    medium: 0,
    high: 0,
    topRules: [],
  };
  const ruleMap = new Map();

  rows.forEach((row) => {
    const severity = String(row.severity || "").toLowerCase();
    if (summary[severity] !== undefined) summary[severity] += 1;
    const rule = String(row.rule_code || "ok");
    ruleMap.set(rule, Number(ruleMap.get(rule) || 0) + 1);
  });

  summary.topRules = [...ruleMap.entries()]
    .map(([ruleCode, total]) => ({ ruleCode, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  return summary;
};

module.exports = {
  DATE_PATTERN,
  isValidDateInput,
  getSalesReportRows,
  buildSalesSummary,
  getFraudAuditRows,
  buildFraudAuditSummary,
};
