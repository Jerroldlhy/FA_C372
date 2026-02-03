const pool = require("./db");

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
    await connection.query("UPDATE wallet SET balance = balance - ? WHERE user_id = ?", [
      price,
      studentId,
    ]);
    await connection.query(
      "INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, 'completed')",
      [studentId, "wallet_payment", price]
    );

    await connection.query("INSERT INTO enrollments (course_id, student_id) VALUES (?, ?)", [
      courseId,
      studentId,
    ]);
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
};
