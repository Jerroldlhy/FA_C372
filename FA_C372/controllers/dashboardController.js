const { getWalletBalance, addWalletBalance } = require("../models/walletModel");
const { getTransactionsForUser, createTransaction, getAllTransactions } = require("../models/transactionModel");
const {
  getEnrollmentsByStudent,
  getDistinctStudentCount,
  getEnrollmentsByUserForAdmin,
  getEnrollmentsByInstructorCourse,
  getCompletionTrendForInstructor,
  getEnrollmentTrendForInstructor,
} = require("../models/enrollmentModel");
const {
  getCoursesWithStats,
  getCoursesByInstructor,
  getInstructorCourseSummaries,
} = require("../models/courseModel");
const { getReviewsForCourses } = require("../models/reviewModel");
const {
  getLecturerRevenueSummary,
  getLecturerMonthlyRevenue,
} = require("../models/orderModel");
const { getAnnouncementsForLecturer, getAnnouncementsForStudent } = require("../models/announcementModel");
const { getOrdersByUser } = require("../models/orderModel");
const { getByUser: getRefundsByUser } = require("../models/refundRequestModel");
const { getFraudEventsSummary, getRecentFraudEvents } = require("../models/paymentAttemptModel");
const {
  getAllUsers,
  getUserById,
  getLecturers,
  updateUserRole,
  updateUserAccountStatus,
} = require("../models/userModel");
const { getSubscriptionByUser } = require("../models/subscriptionModel");
const { getUserActivities, getRecentActivities, logUserActivity } = require("../models/userActivityModel");
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
    const [enrollments, walletBalance, transactions, announcements, orders, refunds] = await Promise.all([
      getEnrollmentsByStudent(userId),
      getWalletBalance(userId),
      getTransactionsForUser(userId),
      getAnnouncementsForStudent(userId, 6),
      getOrdersByUser(userId),
      getRefundsByUser(userId),
    ]);
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
      orders,
      refunds,
      announcements,
      status: req.query,
    });
  } catch (err) {
    next(err);
  }
};

const lecturerDashboard = async (req, res, next) => {
  try {
    const lecturerId = req.user.id;
    const selectedAnnouncementCourseId = Number(req.query.announcement_course || 0) || null;
    const announcementSearch = String(req.query.announcement_q || "").trim().toLowerCase();
    const [courses, enrollments, studentCount, completionTrend, enrollmentTrend, announcements, revenueSummary, monthlyRevenue, lecturerTransactions] =
      await Promise.all([
        getInstructorCourseSummaries(lecturerId),
        getEnrollmentsByInstructorCourse(lecturerId),
        getDistinctStudentCount(lecturerId),
        getCompletionTrendForInstructor(lecturerId, 6),
        getEnrollmentTrendForInstructor(lecturerId, 6),
        getAnnouncementsForLecturer(lecturerId, 20, selectedAnnouncementCourseId),
        getLecturerRevenueSummary(lecturerId),
        getLecturerMonthlyRevenue(lecturerId, 6),
        getTransactionsForUser(lecturerId, 120),
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
    const courseIds = courses.map((course) => Number(course.id));
    const reviewRows = courseIds.length ? await getReviewsForCourses(courseIds) : [];
    const reviewsByCourse = {};
    reviewRows.forEach((review) => {
      const key = Number(review.course_id);
      if (!reviewsByCourse[key]) reviewsByCourse[key] = [];
      reviewsByCourse[key].push(review);
    });
    const topCourses = [...courses]
      .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
      .slice(0, 5);
    const ratingDistribution = [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      count: courses.filter((c) => Math.round(Number(c.avg_rating || 0)) === rating).length,
    }));
    const payouts = (lecturerTransactions || []).filter((tx) =>
      String(tx.type || "").toLowerCase().includes("payout")
    );
    const lastPayout = payouts.length ? payouts[0].created_at : null;
    const totalPayout = payouts.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const pendingPayoutEstimate = Math.max(0, Number(revenueSummary?.totalRevenue || 0) - totalPayout);
    const filteredAnnouncements = announcements.filter((note) => {
      if (!announcementSearch) return true;
      const text = `${note.title || ""} ${note.message || ""} ${note.course_name || ""}`.toLowerCase();
      return text.includes(announcementSearch);
    });

    res.render("lecturerDashboard", {
      courses,
      rosterList,
      completionTrend,
      enrollmentTrend,
      reviewsByCourse,
      topCourses,
      ratingDistribution,
      announcements: filteredAnnouncements,
      announcementFilters: {
        courseId: selectedAnnouncementCourseId,
        q: announcementSearch,
      },
      totalRevenue,
      totalEnrollments,
      studentCount,
      revenueSummary,
      pendingPayoutEstimate,
      lastPayout,
      monthlyRevenue,
      status: req.query,
    });
  } catch (err) {
    next(err);
  }
};

const adminDashboard = async (req, res, next) => {
  try {
    const [users, courses, transactions, lecturers, recentActivities, fraudSummary, recentFraudEvents] =
      await Promise.all([
      getAllUsers(),
      getCoursesWithStats(),
      getAllTransactions(),
      getLecturers(),
      getRecentActivities(20),
      getFraudEventsSummary(24),
      getRecentFraudEvents(25),
    ]);
    res.render("adminDashboard", {
      users,
      courses,
      transactions,
      lecturers,
      recentActivities,
      fraudSummary,
      recentFraudEvents,
      status: req.query,
    });
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
    let subscriptionNextBillingDate = null;
    if (subscription && String(subscription.status || "").toLowerCase() === "active") {
      const base = new Date(subscription.starts_at);
      if (!Number.isNaN(base.getTime())) {
        const next = new Date(base);
        const now = new Date();
        while (next <= now) {
          next.setMonth(next.getMonth() + 1);
        }
        subscriptionNextBillingDate = next;
      }
    }

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
      subscriptionNextBillingDate,
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
      baseCurrency: DEFAULT_CURRENCY,
      currencySymbol: getSymbol(selectedCurrency),
      baseCurrencySymbol: getSymbol(DEFAULT_CURRENCY),
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
