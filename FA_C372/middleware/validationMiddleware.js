const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_OPTIONS = new Set(["student", "lecturer", "admin"]);
const ACCOUNT_STATUS_OPTIONS = new Set(["active", "suspended"]);
const PAYMENT_METHODS = new Set(["wallet", "paypal", "stripe", "nets"]);
const MAX_CART_QTY = 20;

const asTrimmedString = (value, maxLen = 255) => String(value || "").trim().slice(0, maxLen);
const asPositiveInt = (value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
};

const validateLogin = (req, res, next) => {
  const email = asTrimmedString(req.body.email, 100).toLowerCase();
  const password = String(req.body.password || "");
  if (!EMAIL_PATTERN.test(email) || !password) {
    return res.status(400).render("login", { error: "Valid email and password are required.", info: null });
  }
  req.body.email = email;
  next();
};

const validateSignup = (req, res, next) => {
  const firstName = asTrimmedString(req.body.first_name, 60);
  const lastName = asTrimmedString(req.body.last_name, 60);
  const email = asTrimmedString(req.body.email, 100).toLowerCase();
  const password = String(req.body.password || "");

  if (!firstName || !lastName || !EMAIL_PATTERN.test(email) || password.length < 8) {
    return res.status(400).render("signup", { error: "Use valid name, email, and password (8+ chars)." });
  }

  req.body.first_name = firstName;
  req.body.last_name = lastName;
  req.body.email = email;
  next();
};

const validateForgotPassword = (req, res, next) => {
  const email = asTrimmedString(req.body.email, 100).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).render("forgotPassword", { error: "Please enter a valid email address.", info: null });
  }
  req.body.email = email;
  next();
};

const validateResetPassword = (req, res, next) => {
  const token = asTrimmedString(req.body.token, 180);
  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirm_password || "");
  if (!token) return res.status(400).render("resetPassword", { error: "Invalid reset token.", token: null });
  if (password.length < 8) {
    return res.status(400).render("resetPassword", { error: "Password must be at least 8 characters.", token });
  }
  if (password !== confirmPassword) {
    return res.status(400).render("resetPassword", { error: "Passwords do not match.", token });
  }
  req.body.token = token;
  next();
};

const validateCourseCreate = (req, res, next) => {
  const courseName = asTrimmedString(req.body.course_name, 255);
  const price = Number(req.body.price);
  if (!courseName || !Number.isFinite(price) || price < 0) {
    return res.redirect("/courses?course_error=invalid_input");
  }
  req.body.course_name = courseName;
  req.body.price = price.toFixed(2);
  next();
};

const validateCourseUpdate = (req, res, next) => {
  const courseName = asTrimmedString(req.body.course_name, 255);
  const price = Number(req.body.price);
  if (!courseName || !Number.isFinite(price) || price < 0) {
    return res.redirect("/courses?course_error=invalid_input");
  }
  req.body.course_name = courseName;
  req.body.price = price.toFixed(2);
  next();
};

const validateCourseIdParam = (req, res, next) => {
  const courseId = asPositiveInt(req.params.id);
  if (!courseId) return res.redirect("/courses?course_error=invalid_id");
  req.validated = { ...(req.validated || {}), courseId };
  next();
};

const validateCartQuantityUpdate = (req, res, next) => {
  const courseId = asPositiveInt(req.params.id);
  const quantity = asPositiveInt(req.body.quantity);
  if (!courseId) return res.redirect("/cart?qty_error=invalid_course");
  if (!quantity || quantity > MAX_CART_QTY) return res.redirect("/cart?qty_error=invalid_quantity");
  req.validated = { ...(req.validated || {}), courseId, quantity };
  next();
};

const validateCheckout = (req, res, next) => {
  const paymentMethod = asTrimmedString(req.body.payment_method, 30).toLowerCase();
  if (!PAYMENT_METHODS.has(paymentMethod)) {
    return res.redirect("/cart?checkout_error=invalid_payment_method");
  }
  req.body.payment_method = paymentMethod;
  next();
};

const validateAdminRoleUpdate = (req, res, next) => {
  const userId = asPositiveInt(req.params.id);
  const role = asTrimmedString(req.body.role, 20).toLowerCase();
  if (!userId || !ROLE_OPTIONS.has(role)) {
    return res.redirect("/dashboard/admin?role_updated=invalid");
  }
  req.validated = { ...(req.validated || {}), userId, role };
  next();
};

const validateTopUp = (req, res, next) => {
  const amount = Number(req.body.amount);
  const paymentMethod = asTrimmedString(req.body.payment_method, 30).toLowerCase() || "wallet";
  if (!Number.isFinite(amount) || amount <= 0) return res.redirect("/dashboard/student?topup_error=1");
  if (!PAYMENT_METHODS.has(paymentMethod)) return res.redirect("/dashboard/student?topup_error=1");
  req.body.amount = amount;
  req.body.payment_method = paymentMethod;
  next();
};

const validateAdminUserIdParam = (req, res, next) => {
  const userId = asPositiveInt(req.params.id);
  if (!userId) return res.redirect("/dashboard/admin?user=invalid");
  req.validated = { ...(req.validated || {}), userId };
  next();
};

const validateAdminStatusUpdate = (req, res, next) => {
  const userId = asPositiveInt(req.params.id);
  const accountStatus = asTrimmedString(req.body.account_status, 20).toLowerCase();
  if (!userId || !ACCOUNT_STATUS_OPTIONS.has(accountStatus)) {
    return res.redirect("/dashboard/admin?status_updated=invalid");
  }
  req.validated = { ...(req.validated || {}), userId, accountStatus };
  next();
};

module.exports = {
  validateLogin,
  validateSignup,
  validateForgotPassword,
  validateResetPassword,
  validateCourseCreate,
  validateCourseUpdate,
  validateCourseIdParam,
  validateCartQuantityUpdate,
  validateCheckout,
  validateAdminRoleUpdate,
  validateAdminUserIdParam,
  validateAdminStatusUpdate,
  validateTopUp,
  MAX_CART_QTY,
};
