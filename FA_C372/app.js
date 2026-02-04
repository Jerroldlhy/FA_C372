const path = require("path");
const express = require("express");
const session = require("express-session");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
const pool = require("./models/db");
const MySQLSessionStore = require("./models/mysqlSessionStore");
const { enforceSameOrigin } = require("./middleware/securityMiddleware");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(enforceSameOrigin);

const authController = require("./controllers/authController");
const courseController = require("./controllers/courseController");
const cartController = require("./controllers/cartController");
const orderController = require("./controllers/orderController");
const paymentController = require("./controllers/paymentController");
const dashboardController = require("./controllers/dashboardController");
const lecturerController = require("./controllers/lecturerController");
const learningController = require("./controllers/learningController");
const pageController = require("./controllers/pageController");
const reportController = require("./controllers/reportController");
const { ensureCompletionColumn } = require("./models/enrollmentModel");
const { ensureTables: ensurePaymentTables } = require("./models/paymentAttemptModel");
const { ensureTable: ensureSubscriptionTable } = require("./models/subscriptionModel");
const { ensureTable: ensureUserActivityTable, logUserActivity } = require("./models/userActivityModel");
const { ensureAnnouncementsTable, ensureRecipientCountColumn } = require("./models/announcementModel");
const { ensureAccountStatusColumns, ensurePasswordResetColumns } = require("./models/userModel");
const validators = require("./middleware/validationMiddleware");

const sessionTtlHours = Number(process.env.SESSION_TTL_HOURS || 2);
const sessionSecret = process.env.SESSION_SECRET || process.env.JWT_SECRET || "dev_secret_change_me";
const sessionStore = new MySQLSessionStore(pool, {
  ttlMs: sessionTtlHours * 60 * 60 * 1000,
});

app.use(
  session({
    name: "connect.sid",
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: sessionTtlHours * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })
);

const attachCurrentUser = (req, res, next) => {
  res.locals.currentUser = null;
  if (!req.session || !req.session.user) {
    return next();
  }
  req.user = req.session.user;
  res.locals.currentUser = req.session.user;
  next();
};

app.use(attachCurrentUser);

const authenticateToken = (req, res, next) => {
  if (req.user) {
    return next();
  }
  if (!req.session || !req.session.user) {
    return res.redirect("/login");
  }
  req.user = req.session.user;
  res.locals.currentUser = req.session.user;
  next();
};

const requireRole = (allowedRoles) => (req, res, next) => {
  const role = req.user?.role ? String(req.user.role).toLowerCase() : null;
  if (!role || !allowedRoles.map((r) => r.toLowerCase()).includes(role)) {
    return res.status(403).send("Forbidden");
  }
  next();
};

app.get("/", pageController.home);
app.get("/courses", courseController.listCourses);
app.get("/courses/:id", courseController.getCourseDetails);
app.post(
  "/courses",
  authenticateToken,
  requireRole(["lecturer", "admin"]),
  validators.validateCourseCreate,
  courseController.handleCreateCourse
);
app.post(
  "/courses/:id/update",
  authenticateToken,
  requireRole(["lecturer", "admin"]),
  validators.validateCourseIdParam,
  validators.validateCourseUpdate,
  courseController.handleUpdateCourse
);
app.post(
  "/courses/:id/delete",
  authenticateToken,
  requireRole(["lecturer", "admin"]),
  validators.validateCourseIdParam,
  courseController.handleDeleteCourse
);
app.post(
  "/courses/:id/review",
  authenticateToken,
  requireRole(["student"]),
  validators.validateCourseIdParam,
  courseController.handleReview
);
app.post(
  "/courses/:id/enroll",
  authenticateToken,
  requireRole(["student"]),
  validators.validateCourseIdParam,
  courseController.handleEnroll
);
app.post(
  "/courses/:id/cart",
  authenticateToken,
  requireRole(["student"]),
  validators.validateCourseIdParam,
  cartController.addCourseToCart
);
app.get("/mentors", pageController.mentors);
app.get("/plans", pageController.plans);
app.post("/plans/subscribe", authenticateToken, requireRole(["student"]), pageController.subscribePlan);
app.post("/plans/cancel", authenticateToken, requireRole(["student"]), pageController.cancelPlan);
app.get("/login", authController.showLogin);
app.get("/auth/google", authController.googleRedirect);
app.get("/signup", authController.showSignup);
app.get("/forgot-password", authController.showForgotPassword);
app.get("/reset-password", authController.showResetPassword);
app.post("/login", validators.validateLogin, authController.login);
app.post("/signup", validators.validateSignup, authController.signup);
app.post("/resend-verification", authController.resendVerification);
app.get("/verify-email", authController.verifyEmail);
app.post("/forgot-password", validators.validateForgotPassword, authController.requestPasswordReset);
app.post("/reset-password", validators.validateResetPassword, authController.resetPassword);

app.get("/dashboard/student", authenticateToken, requireRole(["student"]), dashboardController.studentDashboard);
app.get(
  "/dashboard/lecturer",
  authenticateToken,
  requireRole(["lecturer"]),
  dashboardController.lecturerDashboard
);

app.post(
  "/dashboard/lecturer/courses/:id/announce",
  authenticateToken,
  requireRole(["lecturer"]),
  validators.validateCourseIdParam,
  validators.validateAnnouncement,
  lecturerController.sendCourseAnnouncement
);
app.get(
  "/dashboard/lecturer/courses/:id/roster/export",
  authenticateToken,
  requireRole(["lecturer"]),
  validators.validateCourseIdParam,
  lecturerController.exportCourseRoster
);

const requireAdmin = (req, res, next) => {
  if (!req.user || String(req.user.role).toLowerCase() !== "admin") {
    return res.status(403).send("Forbidden");
  }
  next();
};

app.get(
  "/dashboard/admin",
  authenticateToken,
  requireAdmin,
  dashboardController.adminDashboard
);

app.post(
  "/admin/courses",
  authenticateToken,
  requireAdmin,
  validators.validateCourseCreate,
  courseController.handleCreateCourse
);
app.post(
  "/admin/courses/:id/update",
  authenticateToken,
  requireAdmin,
  validators.validateCourseIdParam,
  validators.validateCourseUpdate,
  courseController.handleUpdateCourse
);
app.post(
  "/admin/courses/:id/delete",
  authenticateToken,
  requireAdmin,
  validators.validateCourseIdParam,
  courseController.handleDeleteCourse
);
app.post(
  "/admin/users/:id/role",
  authenticateToken,
  requireAdmin,
  validators.validateAdminRoleUpdate,
  dashboardController.updateRole
);
app.get(
  "/admin/users/:id",
  authenticateToken,
  requireAdmin,
  validators.validateAdminUserIdParam,
  dashboardController.adminUserDetails
);
app.post(
  "/admin/users/:id/status",
  authenticateToken,
  requireAdmin,
  validators.validateAdminStatusUpdate,
  dashboardController.updateUserStatus
);
app.get(
  "/admin/reports/sales",
  authenticateToken,
  requireAdmin,
  reportController.showSalesReport
);
app.get(
  "/admin/reports/sales/export",
  authenticateToken,
  requireAdmin,
  reportController.exportSalesReport
);
app.get(
  "/admin/reports/fraud",
  authenticateToken,
  requireAdmin,
  reportController.showFraudAuditReport
);
app.get(
  "/admin/reports/fraud/export",
  authenticateToken,
  requireAdmin,
  reportController.exportFraudAuditReport
);
app.get(
  "/admin/reports/audit",
  authenticateToken,
  requireAdmin,
  reportController.showAuditLogReport
);
app.get(
  "/admin/reports/audit/export",
  authenticateToken,
  requireAdmin,
  reportController.exportAuditLogReport
);

app.post("/wallet/topup", authenticateToken, requireRole(["student"]), validators.validateTopUp, dashboardController.topUpWallet);
app.post("/wallet/payment/start", authenticateToken, requireRole(["student"]), validators.validateTopUp, paymentController.startWalletTopUpPayment);
app.get("/wallet/payment", authenticateToken, requireRole(["student"]), paymentController.showWalletTopUpPayment);
app.post("/wallet/payment/currency", authenticateToken, requireRole(["student"]), validators.validateCurrencySelection, paymentController.setWalletTopUpCurrency);
app.get("/wallet", authenticateToken, requireRole(["student"]), dashboardController.walletPage);
app.post("/api/wallet/topup/paypal/create-order", authenticateToken, requireRole(["student"]), paymentController.createTopUpPaypalOrder);
app.post("/api/wallet/topup/paypal/capture-order", authenticateToken, requireRole(["student"]), paymentController.captureTopUpPaypalOrder);
app.post("/api/wallet/topup/stripe/create-checkout-session", authenticateToken, requireRole(["student"]), paymentController.createTopUpStripeSession);
app.get("/wallet/topup/stripe/success", authenticateToken, requireRole(["student"]), paymentController.stripeTopUpSuccess);
app.post("/wallet/topup/nets/request", authenticateToken, requireRole(["student"]), paymentController.requestTopUpNets);
app.get("/wallet/topup/nets/success", authenticateToken, requireRole(["student"]), paymentController.netsTopUpSuccess);
app.get("/wallet/topup/nets/fail", authenticateToken, requireRole(["student"]), paymentController.netsTopUpFail);
app.get("/cart", authenticateToken, requireRole(["student"]), cartController.showCart);
app.get("/learning", authenticateToken, requireRole(["student"]), learningController.myLearning);
app.get("/learning/:courseId", authenticateToken, requireRole(["student"]), learningController.courseLearning);
app.post(
  "/learning/:courseId/lessons/:lessonNo/complete",
  authenticateToken,
  requireRole(["student"]),
  learningController.completeLesson
);
app.get(
  "/learning/:courseId/certificate",
  authenticateToken,
  requireRole(["student"]),
  learningController.downloadCertificate
);
app.post(
  "/cart/:id/remove",
  authenticateToken,
  requireRole(["student"]),
  validators.validateCourseIdParam,
  cartController.removeCourseFromCart
);
app.post(
  "/payments/currency",
  authenticateToken,
  requireRole(["student"]),
  validators.validateCurrencySelection,
  paymentController.setPaymentCurrency
);
app.post("/checkout", authenticateToken, requireRole(["student"]), validators.validateCheckout, orderController.checkout);
app.get("/orders", authenticateToken, requireRole(["student"]), orderController.listMyOrders);
app.get(
  "/orders/:id",
  authenticateToken,
  requireRole(["student"]),
  orderController.getMyOrderDetails
);
app.post("/api/paypal/create-order", authenticateToken, requireRole(["student"]), paymentController.createPaypalOrder);
app.post("/api/paypal/capture-order", authenticateToken, requireRole(["student"]), paymentController.capturePaypalOrder);
app.post(
  "/api/stripe/create-checkout-session",
  authenticateToken,
  requireRole(["student"]),
  paymentController.createStripeSession
);
app.get("/payments/stripe/success", authenticateToken, requireRole(["student"]), paymentController.stripeSuccess);
app.get("/payments/stripe/cancel", authenticateToken, requireRole(["student"]), paymentController.stripeCancel);
app.post("/payments/nets/request", authenticateToken, requireRole(["student"]), paymentController.requestNets);
app.get(
  "/payments/nets/status/:txnRetrievalRef",
  authenticateToken,
  requireRole(["student"]),
  paymentController.netsStatus
);
app.get("/payments/nets/success", authenticateToken, requireRole(["student"]), paymentController.netsSuccess);
app.get("/payments/nets/fail", authenticateToken, requireRole(["student"]), paymentController.netsFail);
app.post("/api/payments/mark-failed", authenticateToken, requireRole(["student"]), paymentController.markPaymentFailed);
app.get("/api/transactions/me", authenticateToken, requireRole(["student"]), paymentController.listMyTransactions);

app.post("/logout", (req, res) => {
  const userId = req.session?.user?.id || null;
  const actorUserId = req.session?.user?.id || null;
  logUserActivity({
    userId,
    actorUserId,
    activityType: "logout",
    ipAddress: req.ip,
  })
    .catch(() => null)
    .finally(() => {
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.redirect("/login");
      });
    });
});

app.post("/courses/:id/pay", authenticateToken, requireRole(["student"]), validators.validateCourseIdParam, async (req, res, next) => {
  try {
    const paymentMethod = req.body.payment_method || "paypal";
    res.redirect(
      `/courses/${req.params.id}?paid=1&method=${encodeURIComponent(
        paymentMethod
      )}`
    );
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("Server error");
});

const port = process.env.PORT || 3000;
const startServer = async () => {
  await ensureAccountStatusColumns();
  await ensurePasswordResetColumns();
  await ensureUserActivityTable();
  await ensureCompletionColumn();
  await ensureAnnouncementsTable();
  await ensureRecipientCountColumn();
  await sessionStore.ensureTable();
  await ensurePaymentTables();
  await ensureSubscriptionTable();
  setInterval(() => {
    sessionStore.cleanupExpired().catch((err) => {
      console.error("Session cleanup failed:", err.message);
    });
  }, 60 * 60 * 1000).unref();

  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
};

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
