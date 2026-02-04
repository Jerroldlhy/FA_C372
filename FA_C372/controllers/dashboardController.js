const { getWalletBalance, addWalletBalance } = require("../models/walletModel");
const { getTransactionsForUser, createTransaction, getAllTransactions } = require("../models/transactionModel");
const {
  getEnrollmentsByStudent,
  getEnrollmentsForLecturer,
  getDistinctStudentCount,
  getEnrollmentsByUserForAdmin,
} = require("../models/enrollmentModel");
const { getCoursesByInstructor, getCoursesWithStats } = require("../models/courseModel");
const {
  getAllUsers,
  getUserById,
  updateUserRole,
  updateUserAccountStatus,
} = require("../models/userModel");
const { getSubscriptionByUser } = require("../models/subscriptionModel");
const { getUserActivities, logUserActivity } = require("../models/userActivityModel");

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

const updateRole = async (req, res, next) => {
  try {
    const userId = req.validated?.userId || Number(req.params.id);
    const role = req.validated?.role || String(req.body.role || "").toLowerCase();
    const redirectToDetails = String(req.body.redirect_to || "").toLowerCase() === "detail";
    const redirectBase = redirectToDetails ? `/admin/users/${userId}` : "/dashboard/admin";

    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return res.redirect(`${redirectBase}?role_updated=not_found`);
    }

    if (Number(req.user.id) === userId) {
      return res.redirect(`${redirectBase}?role_updated=self`);
    }

    await updateUserRole(userId, role);
    return res.redirect(`${redirectBase}?role_updated=1`);
  } catch (err) {
    return next(err);
  }
};

const adminUserDetails = async (req, res, next) => {
  try {
    const userId = req.validated?.userId || Number(req.params.id);
    const user = await getUserById(userId);
    if (!user) return res.redirect("/dashboard/admin?user=not_found");

    const [enrollments, subscription, activities] = await Promise.all([
      getEnrollmentsByUserForAdmin(userId),
      getSubscriptionByUser(userId),
      getUserActivities(userId, 60),
    ]);

    return res.render("adminUserDetails", {
      user,
      enrollments,
      subscription,
      activities,
      status: req.query,
    });
  } catch (err) {
    return next(err);
  }
};

const updateUserStatus = async (req, res, next) => {
  try {
    const userId = req.validated?.userId || Number(req.params.id);
    const accountStatus = req.validated?.accountStatus || String(req.body.account_status || "").toLowerCase();
    const user = await getUserById(userId);
    if (!user) return res.redirect("/dashboard/admin?status_updated=not_found");
    if (Number(req.user.id) === userId) return res.redirect(`/admin/users/${userId}?status_updated=self`);

    await updateUserAccountStatus(userId, accountStatus);
    await logUserActivity({
      userId,
      actorUserId: req.user.id,
      activityType: accountStatus === "suspended" ? "account_suspended" : "account_reactivated",
      ipAddress: req.ip,
      details: { byAdminId: req.user.id },
    });
    return res.redirect(`/admin/users/${userId}?status_updated=1`);
  } catch (err) {
    return next(err);
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
  updateRole,
  adminUserDetails,
  updateUserStatus,
  walletPage,
  topUpWallet,
};
