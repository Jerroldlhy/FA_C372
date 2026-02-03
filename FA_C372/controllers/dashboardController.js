const { getWalletBalance, addWalletBalance } = require("../models/walletModel");
const { getTransactionsForUser, createTransaction, getAllTransactions } = require("../models/transactionModel");
const { getEnrollmentsByStudent, getEnrollmentsForLecturer, getDistinctStudentCount } = require("../models/enrollmentModel");
const { getCoursesByInstructor, getCoursesWithStats } = require("../models/courseModel");
const { getAllUsers } = require("../models/userModel");

const studentDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const enrollments = await getEnrollmentsByStudent(userId);
    const walletBalance = await getWalletBalance(userId);
    const transactions = await getTransactionsForUser(userId);
    res.render("dashboard", { enrollments, walletBalance, transactions, status: req.query });
  } catch (err) {
    next(err);
  }
};

const lecturerDashboard = async (req, res, next) => {
  try {
    const lecturerId = req.user.id;
    const courses = await getCoursesByInstructor(lecturerId);
    const enrollments = await getEnrollmentsForLecturer(lecturerId);
    const studentCount = await getDistinctStudentCount(lecturerId);
    res.render("lecturerDashboard", { courses, enrollments, studentCount, status: req.query });
  } catch (err) {
    next(err);
  }
};

const adminDashboard = async (req, res, next) => {
  try {
    const users = await getAllUsers();
    const courses = await getCoursesWithStats();
    const transactions = await getAllTransactions();
    res.render("adminDashboard", { users, courses, transactions, status: req.query });
  } catch (err) {
    next(err);
  }
};

const walletPage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const walletBalance = await getWalletBalance(userId);
    const transactions = await getTransactionsForUser(userId, 12);
    res.render("wallet", { walletBalance, transactions, status: req.query });
  } catch (err) {
    next(err);
  }
};

const topUpWallet = async (req, res, next) => {
  try {
    const amount = Number(req.body.amount || 0);
    if (!amount || amount <= 0) return res.redirect("/dashboard/student?topup_error=1");
    const method = (req.body.payment_method || "wallet").toLowerCase();
    const type = method === "wallet" ? "wallet_topup" : `${method}_topup`.replace(/[^a-z0-9_]/g, "");
    const userId = req.user.id;
    await addWalletBalance(userId, amount);
    await createTransaction(userId, type, amount, "completed");
    res.redirect(`/dashboard/student?topup_success=1&method=${method}`);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  studentDashboard,
  lecturerDashboard,
  adminDashboard,
  walletPage,
  topUpWallet,
};
