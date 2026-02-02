const pool = require("../models/db");
const walletModel = require("../models/walletModel");
const transactionModel = require("../models/transactionModel");
const courseModel = require("../models/courseModel");
const paymentService = require("../services/paymentService");
const paymentLogModel = require("../models/paymentLogModel");

const topUpWallet = async (req, res, next) => {
  try {
    const amount = paymentService.parsePositiveAmount(req.body.amount);
    const paymentMethod =
      paymentService.normalizePaymentMethod(req.body.payment_method) || "paypal";
    if (!amount) {
      return res.status(400).json({ error: "Invalid top-up amount." });
    }

    const userId = req.user.id;
    await walletModel.upsertTopUp(userId, amount);
    const transactionId = await transactionModel.createTransaction({
      user_id: userId,
      transaction_type: "top-up",
      amount,
      transaction_status: "completed",
    });
    await paymentLogModel.createPaymentLog({
      user_id: userId,
      payment_method: paymentMethod,
      payment_status: "success",
      amount,
      transaction_id: transactionId,
    });

    const balance = await walletModel.getBalanceByUserId(userId);
    return res.status(200).json({
      message: "Wallet top-up successful.",
      balance,
    });
  } catch (err) {
    next(err);
  }
};

const payForCourse = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const courseId = req.params.id;
    const userId = req.user.id;
    const paymentMethod = paymentService.normalizePaymentMethod(
      req.body.payment_method
    );
    if (!paymentMethod) {
      return res.status(400).json({ error: "Invalid payment method." });
    }

    await connection.beginTransaction();

    const course = await courseModel.findCourseById(courseId);
    if (!course) {
      await connection.rollback();
      return res.status(404).json({ error: "Course not found." });
    }
    const price = Number(course.price);

    const [walletRows] = await connection.query(
      "SELECT balance FROM wallet WHERE user_id = ? LIMIT 1 FOR UPDATE",
      [userId]
    );
    const balance = walletRows.length ? Number(walletRows[0].balance) : 0;
    if (balance < price) {
      await connection.rollback();
      return res.status(400).json({ error: "Insufficient wallet balance." });
    }

    await connection.query(
      "UPDATE wallet SET balance = balance - ? WHERE user_id = ?",
      [price, userId]
    );

    const [transactionResult] = await connection.query(
      "INSERT INTO transactions (user_id, transaction_type, amount, transaction_status) VALUES (?, ?, ?, ?)",
      [userId, "payment", price, "completed"]
    );

    await connection.query(
      "INSERT INTO enrollments (course_id, user_id) VALUES (?, ?)",
      [courseId, userId]
    );
    await connection.query(
      `INSERT INTO payment_api_logs
        (user_id, payment_method, payment_status, amount, transaction_id)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, paymentMethod, "success", price, transactionResult.insertId]
    );

    const [[updated]] = await connection.query(
      "SELECT balance FROM wallet WHERE user_id = ? LIMIT 1",
      [userId]
    );

    await connection.commit();

    return res.status(200).json({
      message: "Payment successful. Enrollment created.",
      course_id: Number(courseId),
      payment_method: paymentMethod,
      balance: updated ? updated.balance : 0,
    });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
};

const listMyTransactions = async (req, res, next) => {
  try {
    const transactions = await transactionModel.listByUserId(req.user.id);
    return res.status(200).json({ transactions });
  } catch (err) {
    next(err);
  }
};

const makePayment = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const userIdFromToken = Number(req.user.id);
    const { user_id, course_id, amount } = req.body;
    const userId = Number(user_id || userIdFromToken);
    const courseId = Number(course_id);
    const paymentAmount = paymentService.parsePositiveAmount(amount);
    const paymentMethod =
      paymentService.normalizePaymentMethod(req.body.payment_method) || "paypal";

    if (!courseId || !paymentAmount) {
      return res.status(400).json({ error: "course_id and amount are required." });
    }
    if (userId !== userIdFromToken) {
      return res.status(403).json({ error: "You can only pay with your own account." });
    }

    await connection.beginTransaction();

    const course = await courseModel.findCourseById(courseId);
    if (!course) {
      await connection.rollback();
      return res.status(404).json({ error: "Course not found." });
    }

    const [walletRows] = await connection.query(
      "SELECT balance FROM wallet WHERE user_id = ? LIMIT 1 FOR UPDATE",
      [userId]
    );
    const balance = walletRows.length ? Number(walletRows[0].balance) : 0;
    if (balance < paymentAmount) {
      await connection.rollback();
      return res.status(400).json({ error: "Insufficient wallet balance." });
    }

    await connection.query(
      "UPDATE wallet SET balance = balance - ? WHERE user_id = ?",
      [paymentAmount, userId]
    );

    const [transactionResult] = await connection.query(
      "INSERT INTO transactions (user_id, transaction_type, amount, transaction_status) VALUES (?, ?, ?, ?)",
      [userId, "payment", paymentAmount, "completed"]
    );

    const existingEnrollment = await courseModel.findEnrollment({
      courseId,
      userId,
    });
    if (!existingEnrollment) {
      await connection.query(
        "INSERT INTO enrollments (course_id, user_id) VALUES (?, ?)",
        [courseId, userId]
      );
    }

    await connection.query(
      `INSERT INTO payment_api_logs
        (user_id, payment_method, payment_status, amount, transaction_id)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, paymentMethod, "success", paymentAmount, transactionResult.insertId]
    );

    const [[updated]] = await connection.query(
      "SELECT balance FROM wallet WHERE user_id = ? LIMIT 1",
      [userId]
    );

    await connection.commit();
    return res.status(200).json({
      message: "Payment successful. Enrollment created.",
      user_id: userId,
      course_id: courseId,
      amount: paymentAmount,
      balance: updated ? updated.balance : 0,
    });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
};

module.exports = {
  topUpWallet,
  payForCourse,
  makePayment,
  listMyTransactions,
};
