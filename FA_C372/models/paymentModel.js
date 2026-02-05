const pool = require("../db");

class WalletError extends Error {
  constructor(message) {
    super(message);
    this.code = "wallet_balance";
  }
}

class ExternalCheckoutRequiredError extends Error {
  constructor(message) {
    super(message);
    this.code = "external_checkout_required";
  }
}

class CourseAvailabilityError extends Error {
  constructor(message) {
    super(message);
    this.code = "out_of_stock";
  }
}

const enrollStudentWithPayment = async (courseId, studentId, price, paymentMethod) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (paymentMethod !== "wallet") {
      throw new ExternalCheckoutRequiredError(
        "Use cart checkout for external payment methods."
      );
    }

    const [walletRows] = await connection.query(
      "SELECT balance FROM wallet WHERE user_id = ? LIMIT 1 FOR UPDATE",
      [studentId]
    );
    const balance = walletRows.length ? Number(walletRows[0].balance) : 0;
    if (balance < price) {
      throw new WalletError("Insufficient wallet balance");
    }

    const [courseRows] = await connection.query(
      "SELECT id, price, stock_qty FROM courses WHERE id = ? LIMIT 1 FOR UPDATE",
      [courseId]
    );
    const course = courseRows[0] || null;
    if (!course) {
      throw new Error("Course not found.");
    }
    const stockQty = Number(course.stock_qty);
    const hasLimitedStock = Number.isFinite(stockQty) && stockQty > 0;
    if (hasLimitedStock && stockQty < 1) {
      throw new CourseAvailabilityError("Course is out of stock.");
    }

    await connection.query("UPDATE wallet SET balance = balance - ? WHERE user_id = ?", [
      price,
      studentId,
    ]);

    const [orderResult] = await connection.query(
      `INSERT INTO orders (user_id, total_amount, payment_status, order_status)
       VALUES (?, ?, 'paid', 'completed')`,
      [studentId, price]
    );
    const orderId = orderResult.insertId;

    await connection.query(
      `INSERT INTO payments (order_id, user_id, method, provider_txn_id, amount, status)
       VALUES (?, ?, 'wallet', NULL, ?, 'completed')`,
      [orderId, studentId, price]
    );

    await connection.query(
      `INSERT INTO order_items (order_id, course_id, unit_price, quantity)
       VALUES (?, ?, ?, 1)`,
      [orderId, courseId, price]
    );

    await connection.query("INSERT INTO enrollments (course_id, student_id) VALUES (?, ?)", [
      courseId,
      studentId,
    ]);

    await connection.query(
      `UPDATE courses
       SET stock_qty = CASE
         WHEN stock_qty > 0 THEN stock_qty - 1
         ELSE stock_qty
       END
       WHERE id = ?`,
      [courseId]
    );

    await connection.query(
      "INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, 'completed')",
      [studentId, "wallet_checkout", price]
    );
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

module.exports = {
  enrollStudentWithPayment,
  WalletError,
  ExternalCheckoutRequiredError,
  CourseAvailabilityError,
};
