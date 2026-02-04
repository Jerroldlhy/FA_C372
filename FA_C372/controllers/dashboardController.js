const { getWalletBalance, addWalletBalance } = require("../models/walletModel");
const { getTransactionsForUser, createTransaction, getAllTransactions } = require("../models/transactionModel");
const {
  getEnrollmentsByStudent,
  getDistinctStudentCount,
  getEnrollmentsByUserForAdmin,
  getEnrollmentsByInstructorCourse,
  getCompletionTrendForInstructor,
} = require("../models/enrollmentModel");
const {
  getCoursesWithStats,
  getCoursesByInstructor,
  getInstructorCourseSummaries,
} = require("../models/courseModel");
const {
  getLecturerRevenueSummary,
  getLecturerMonthlyRevenue,
} = require("../models/orderModel");
const { getAnnouncementsForLecturer } = require("../models/announcementModel");
const {
  getAllUsers,
  getUserById,
  getLecturers,
  updateUserRole,
  updateUserAccountStatus,
} = require("../models/userModel");
const { getSubscriptionByUser } = require("../models/subscriptionModel");
const { getUserActivities, logUserActivity } = require("../models/userActivityModel");
const {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  normaliseCurrency,
  convertAmount,
  getSymbol,
} = require("../services/currency");

const studentDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const enrollments = await getEnrollmentsByStudent(userId);
    const walletBalance = await getWalletBalance(userId);
    const transactions = await getTransactionsForUser(userId);
    const selectedCurrency = normaliseCurrency(req.session?.currency || DEFAULT_CURRENCY);
    const walletDisplayBalance = convertAmount(walletBalance, DEFAULT_CURRENCY, selectedCurrency);
    res.render("dashboard", {
      enrollments,
      walletBalance,
      walletDisplayBalance,
      selectedCurrency,
      currencySymbol: getSymbol(selectedCurrency),
      supportedCurrencies: SUPPORTED_CURRENCIES,
      transactions,
      status: req.query,
    });
  } catch (err) {
    next(err);
  }
};

const lecturerDashboard = async (req, res, next) => {
  try {
    const lecturerId = req.user.id;
    const [courses, enrollments, studentCount, completionTrend, announcements, revenueSummary, monthlyRevenue] =
      await Promise.all([
        getInstructorCourseSummaries(lecturerId),
        getEnrollmentsByInstructorCourse(lecturerId),
        getDistinctStudentCount(lecturerId),
        getCompletionTrendForInstructor(lecturerId, 6),
        getAnnouncementsForLecturer(lecturerId, 5),
        getLecturerRevenueSummary(lecturerId),
        getLecturerMonthlyRevenue(lecturerId, 6),
      ]);

    const rosterMap = {};
    courses.forEach((course) => {
      rosterMap[course.id] = {
        courseId: course.id,
        courseName: course.course_name,
        students: [],
      };
    });
    enrollments.forEach((row) => {
      if (!rosterMap[row.course_id]) {
        rosterMap[row.course_id] = {
          courseId: row.course_id,
          courseName: row.course_name,
          students: [],
        };
      }
      rosterMap[row.course_id].students.push(row);
    });
    const rosterList = Object.values(rosterMap);
    const totalRevenue = courses.reduce((sum, course) => sum + (course.revenue || 0), 0);
    const totalEnrollments = courses.reduce((sum, course) => sum + (course.enrollment_count || 0), 0);

    res.render("lecturerDashboard", {
      courses,
      rosterList,
      completionTrend,
      announcements,
      totalRevenue,
      totalEnrollments,
      studentCount,
      revenueSummary,
      monthlyRevenue,
      status: req.query,
    });
  } catch (err) {
    next(err);
  }
};

const adminDashboard = async (req, res, next) => {
  try {
    const [users, courses, transactions, lecturers] = await Promise.all([
      getAllUsers(),
      getCoursesWithStats(),
      getAllTransactions(),
      getLecturers(),
    ]);
    res.render("adminDashboard", { users, courses, transactions, lecturers, status: req.query });
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
    const isLecturer = String(user.role || "").toLowerCase() === "lecturer";

    const [enrollments, assignedCourses, subscription, activities, transactions] = await Promise.all([
      getEnrollmentsByUserForAdmin(userId),
      isLecturer ? getCoursesByInstructor(userId) : Promise.resolve([]),
      getSubscriptionByUser(userId),
      getUserActivities(userId, 60),
      getTransactionsForUser(userId, 60),
    ]);

    const toTimestamp = (value) => {
      const time = new Date(value).getTime();
      return Number.isFinite(time) ? time : 0;
    };
    const timeline = [
      ...activities.map((item) => ({
        kind: "activity",
        created_at: item.created_at,
        actor_user_id: item.actor_user_id,
        ip_address: item.ip_address,
        activity_type: item.activity_type,
      })),
      ...transactions.map((item) => {
        const type = String(item.type || "").toLowerCase();
        const direction = type.includes("topup")
          ? "topup"
          : type.includes("checkout") || type.includes("payment")
          ? "spend"
          : "neutral";
        return {
          kind: "transaction",
          created_at: item.created_at,
          activity_type: `transaction_${type || "recorded"}`,
          transaction_type: item.type,
          amount: Number(item.amount || 0),
          direction,
          status: item.status,
        };
      }),
    ].sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at));

    return res.render("adminUserDetails", {
      user,
      enrollments,
      assignedCourses,
      subscription,
      timeline,
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
    const selectedCurrency = normaliseCurrency(req.session?.currency || DEFAULT_CURRENCY);
    const walletDisplayBalance = convertAmount(walletBalance, DEFAULT_CURRENCY, selectedCurrency);
    res.render("wallet", {
      walletBalance,
      walletDisplayBalance,
      selectedCurrency,
      currencySymbol: getSymbol(selectedCurrency),
      supportedCurrencies: SUPPORTED_CURRENCIES,
      transactions,
      status: req.query,
    });
  } catch (err) {
    next(err);
  }
};

const topUpWallet = async (req, res, next) => {
  try {
    const amount = Number(req.body.amount || 0);
    if (!amount || amount <= 0) return res.redirect("/dashboard/student?topup_error=1");
    const method = (req.body.payment_method || "wallet").toLowerCase();
    if (method !== "wallet") return res.redirect("/wallet?topup_error=external_flow");
    const selectedCurrency = normaliseCurrency(req.body.currency || req.session?.currency || DEFAULT_CURRENCY);
    const walletAmount = convertAmount(amount, selectedCurrency, DEFAULT_CURRENCY);
    if (!walletAmount || walletAmount <= 0) return res.redirect("/dashboard/student?topup_error=1");
    const type = "wallet_topup";
    const userId = req.user.id;
    await addWalletBalance(userId, walletAmount);
    await createTransaction(userId, type, walletAmount, "completed");
    res.redirect(`/dashboard/student?topup_success=1&method=${method}&currency=${selectedCurrency}`);
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
