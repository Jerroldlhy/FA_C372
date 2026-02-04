const pool = require("./db");
const { clearCartByUser } = require("./cartModel");

class CheckoutError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const getOrdersByUser = async (userId) => {
  const [rows] = await pool.query(
    `SELECT id, total_amount, payment_status, order_status, created_at
     FROM orders
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
};

const getOrderByIdForUser = async (orderId, userId) => {
  const [orders] = await pool.query(
    `SELECT id, user_id, total_amount, payment_status, order_status, created_at
     FROM orders
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [orderId, userId]
  );
  if (!orders.length) return null;
  const order = orders[0];
  const [items] = await pool.query(
    `SELECT oi.course_id, oi.unit_price, oi.quantity, c.course_name
     FROM order_items oi
     JOIN courses c ON c.id = oi.course_id
     WHERE oi.order_id = ?
     ORDER BY oi.id`,
    [orderId]
  );
  return { ...order, items };
};

const createOrderFromCart = async (userId, paymentMethod = "wallet") => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [cartRows] = await connection.query(
      `SELECT ci.course_id, ci.quantity, c.price, c.stock_qty
       FROM carts ca
       JOIN cart_items ci ON ci.cart_id = ca.id
       JOIN courses c ON c.id = ci.course_id
       WHERE ca.user_id = ?
       ORDER BY ci.id
       FOR UPDATE`,
      [userId]
    );

    if (!cartRows.length) {
      throw new CheckoutError("empty_cart", "Your cart is empty.");
    }

    const courseIds = [...new Set(cartRows.map((row) => Number(row.course_id)))];
    const [enrolledRows] = await connection.query(
      "SELECT course_id FROM enrollments WHERE student_id = ? AND course_id IN (?)",
      [userId, courseIds]
    );
    const enrolledSet = new Set(enrolledRows.map((row) => Number(row.course_id)));
    const purchasable = cartRows.filter((row) => !enrolledSet.has(Number(row.course_id)));
    if (!purchasable.length) {
      throw new CheckoutError("already_enrolled", "All cart items are already enrolled.");
    }

    // One cart line equals one course enrollment (quantity is fixed to 1).
    const purchasableCourses = purchasable.map((item) => ({
      ...item,
      quantity: 1,
    }));

    // Support both limited-seat and unlimited-seat courses:
    // - stock_qty > 0 => enforce availability
    // - stock_qty <= 0 or null => treat as unlimited
    for (const item of purchasableCourses) {
      const qty = 1;
      const stockQty = Number(item.stock_qty);
      const hasLimitedStock = Number.isFinite(stockQty) && stockQty > 0;
      if (hasLimitedStock && stockQty < qty) {
        throw new CheckoutError("out_of_stock", "One or more courses are out of stock.");
      }
    }

    const total = purchasableCourses.reduce((sum, row) => {
      return sum + Number(row.price || 0);
    }, 0);

    if (paymentMethod === "wallet") {
      const [walletRows] = await connection.query(
        "SELECT balance FROM wallet WHERE user_id = ? LIMIT 1 FOR UPDATE",
        [userId]
      );
      const balance = walletRows.length ? Number(walletRows[0].balance) : 0;
      if (balance < total) {
        throw new CheckoutError("wallet_balance", "Insufficient wallet balance.");
      }
      await connection.query("UPDATE wallet SET balance = balance - ? WHERE user_id = ?", [
        total,
        userId,
      ]);
    }

    const [orderResult] = await connection.query(
      `INSERT INTO orders (user_id, total_amount, payment_status, order_status)
       VALUES (?, ?, 'paid', 'completed')`,
      [userId, total]
    );
    const orderId = orderResult.insertId;

    for (const item of purchasableCourses) {
      await connection.query(
        `INSERT INTO order_items (order_id, course_id, unit_price, quantity)
         VALUES (?, ?, ?, ?)`,
        [orderId, item.course_id, item.price, 1]
      );

      await connection.query(
        `INSERT INTO enrollments (course_id, student_id)
         SELECT ?, ?
         FROM DUAL
         WHERE NOT EXISTS (
           SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?
         )`,
        [item.course_id, userId, item.course_id, userId]
      );

      const [stockUpdate] = await connection.query(
        `UPDATE courses
         SET stock_qty = CASE
           WHEN stock_qty > 0 THEN stock_qty - ?
           ELSE stock_qty
         END
         WHERE id = ? AND (stock_qty <= 0 OR stock_qty >= ?)`,
        [1, item.course_id, 1]
      );
      if (!stockUpdate || Number(stockUpdate.affectedRows || 0) === 0) {
        throw new CheckoutError("out_of_stock", "One or more courses are out of stock.");
      }
    }

    await connection.query(
      `INSERT INTO transactions (user_id, type, amount, status)
       VALUES (?, ?, ?, 'completed')`,
      [userId, `${paymentMethod}_checkout`, total]
    );

    await clearCartByUser(userId, connection);
    await connection.commit();

    return { orderId, total };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

const getLecturerRevenueSummary = async (lecturerId) => {
  if (!lecturerId) {
    return {
      totalRevenue: 0,
      orderCount: 0,
      courseCount: 0,
    };
  }
  const [rows] = await pool.query(
    `SELECT
       COALESCE(SUM(oi.unit_price * oi.quantity), 0) AS total_revenue,
       COUNT(DISTINCT oi.order_id) AS order_count,
       COUNT(DISTINCT c.id) AS course_count
     FROM order_items oi
     JOIN courses c ON oi.course_id = c.id
     WHERE c.instructor_id = ?`,
    [lecturerId]
  );
  const row = rows[0] || {};
  return {
    totalRevenue: Number(row.total_revenue || 0),
    orderCount: Number(row.order_count || 0),
    courseCount: Number(row.course_count || 0),
  };
};

const getLecturerMonthlyRevenue = async (lecturerId, months = 6) => {
  if (!lecturerId) return [];
  const safeMonths = Math.max(1, Math.min(Number(months) || 6, 12));
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(o.created_at, '%Y-%m') AS period,
            SUM(oi.unit_price * oi.quantity) AS revenue
     FROM order_items oi
     JOIN courses c ON oi.course_id = c.id
     JOIN orders o ON oi.order_id = o.id
     WHERE c.instructor_id = ?
     GROUP BY period
     ORDER BY period DESC
     LIMIT ?`,
    [lecturerId, safeMonths]
  );
  return rows.map((row) => ({
    period: row.period,
    revenue: Number(row.revenue || 0),
  }));
};

module.exports = {
  CheckoutError,
  createOrderFromCart,
  getOrdersByUser,
  getOrderByIdForUser,
  getLecturerRevenueSummary,
  getLecturerMonthlyRevenue,
};
