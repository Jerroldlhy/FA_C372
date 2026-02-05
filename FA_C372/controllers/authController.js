const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const speakeasy = require("speakeasy");
const qrcode = require("qrcode");
const {
  getUserByEmail,
  getUserWithTwoFactorById,
  createUser,
  updateVerificationToken,
  markEmailVerified,
  getUserByVerificationToken,
  setPasswordResetToken,
  getUserByPasswordResetToken,
  updatePasswordByUserId,
  enableTwoFactor,
  disableTwoFactor,
} = require("../models/userModel");
const { sendVerificationEmail, sendPasswordResetEmail, sendMail } = require("../services/emailService");
const { logUserActivity } = require("../models/userActivityModel");

const requireEmailVerification =
  (process.env.REQUIRE_EMAIL_VERIFICATION || "false").toLowerCase() === "true";

const showLogin = (req, res) => {
  res.render("login", { error: null, info: req.query });
};

const showLogin2FA = (req, res) => {
  if (!req.session?.pending2FAUserId) {
    return res.redirect("/login");
  }
  return res.render("login2fa", {
    error: null,
    info: req.query,
    email: req.session.pending2FAUserEmail || "",
  });
};

const showSignup = (req, res) => {
  res.render("signup", { error: null });
};

const showForgotPassword = (req, res) => {
  res.render("forgotPassword", { error: null, info: req.query });
};

const showResetPassword = async (req, res, next) => {
  try {
    const token = (req.query.token || "").trim();
    if (!token) {
      return res.render("resetPassword", { error: "Invalid or missing reset token.", token: null });
    }
    const user = await getUserByPasswordResetToken(token);
    if (!user || !user.password_reset_expires_at || new Date(user.password_reset_expires_at) < new Date()) {
      return res.render("resetPassword", { error: "This reset link is invalid or expired.", token: null });
    }
    return res.render("resetPassword", { error: null, token });
  } catch (err) {
    return next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).render("login", { error: "Email and password are required." });
    }
    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(401).render("login", { error: "Invalid email or password.", info: null });
    }
    if (String(user.account_status || "active").toLowerCase() === "suspended") {
      return res.status(403).render("login", { error: "Your account is suspended. Please contact an administrator.", info: null });
    }
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (requireEmailVerification && !user.email_verified) {
      return res
        .status(403)
        .render("login", { error: "Please verify your email before logging in.", info: { pending_verification: true } });
    }
    if (!isValid) {
      return res.status(401).render("login", { error: "Invalid email or password.", info: null });
    }

    const hasTwoFactor = Number(user.is_2fa_enabled || 0) === 1 && Boolean(user.twofactor_secret);
    if (hasTwoFactor) {
      req.session.pending2FAUserId = user.id;
      req.session.pending2FAUserEmail = user.email;
      await new Promise((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
      return res.redirect("/login/2fa");
    }

    req.session.user = { id: user.id, role: user.role, name: user.name, is_2fa_enabled: Number(user.is_2fa_enabled || 0) };
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    await logUserActivity({
      userId: user.id,
      actorUserId: user.id,
      activityType: "login",
      ipAddress: req.ip,
    });
    const role = (user.role || "").toLowerCase();
    if (role === "admin") return res.redirect("/dashboard/admin");
    if (role === "lecturer") return res.redirect("/dashboard/lecturer");
    return res.redirect("/dashboard/student");
  } catch (err) {
    next(err);
  }
};

const verifyLogin2FA = async (req, res, next) => {
  try {
    const pendingUserId = Number(req.session?.pending2FAUserId || 0);
    if (!pendingUserId) {
      return res.redirect("/login");
    }

    const token = String(req.body?.token || "").trim();
    if (!/^\d{6}$/.test(token)) {
      return res.status(400).render("login2fa", {
        error: "Please enter a valid 6-digit code.",
        info: null,
        email: req.session.pending2FAUserEmail || "",
      });
    }

    const user = await getUserWithTwoFactorById(pendingUserId);
    if (!user || !user.twofactor_secret || Number(user.is_2fa_enabled || 0) !== 1) {
      req.session.pending2FAUserId = null;
      req.session.pending2FAUserEmail = null;
      await new Promise((resolve) => req.session.save(() => resolve()));
      return res.redirect("/login?twofa_error=not_enabled");
    }

    const isValid = speakeasy.totp.verify({
      secret: user.twofactor_secret,
      encoding: "base32",
      token,
      window: 1,
    });
    if (!isValid) {
      return res.status(401).render("login2fa", {
        error: "Invalid 2FA code.",
        info: null,
        email: req.session.pending2FAUserEmail || "",
      });
    }

    req.session.user = { id: user.id, role: user.role, name: user.name, is_2fa_enabled: 1 };
    req.session.pending2FAUserId = null;
    req.session.pending2FAUserEmail = null;
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    await logUserActivity({
      userId: user.id,
      actorUserId: user.id,
      activityType: "login",
      ipAddress: req.ip,
      details: { via2FA: true },
    });

    const role = String(user.role || "").toLowerCase();
    if (role === "admin") return res.redirect("/dashboard/admin");
    if (role === "lecturer") return res.redirect("/dashboard/lecturer");
    return res.redirect("/dashboard/student");
  } catch (err) {
    return next(err);
  }
};

const show2FASetup = async (req, res, next) => {
  try {
    if (!req.user?.id) return res.redirect("/login");
    const currentUser = await getUserWithTwoFactorById(req.user.id);
    if (!currentUser) return res.redirect("/login");

    const secret = speakeasy.generateSecret({
      length: 20,
      name: `EduSphere (${currentUser.email})`,
    });
    req.session.temp2FASecret = secret.base32;
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    const qrCodeDataURL = await qrcode.toDataURL(secret.otpauth_url);
    return res.render("twoFactorSetup", {
      error: null,
      info: req.query,
      qrCodeDataURL,
      manualKey: secret.base32,
      isEnabled: Number(currentUser.is_2fa_enabled || 0) === 1,
    });
  } catch (err) {
    return next(err);
  }
};

const verify2FASetup = async (req, res, next) => {
  try {
    if (!req.user?.id) return res.redirect("/login");
    const token = String(req.body?.token || "").trim();
    const tempSecret = req.session?.temp2FASecret || null;
    if (!tempSecret) return res.redirect("/2fa/setup?error=missing_secret");
    if (!/^\d{6}$/.test(token)) return res.redirect("/2fa/setup?error=invalid_code");

    const verified = speakeasy.totp.verify({
      secret: tempSecret,
      encoding: "base32",
      token,
      window: 1,
    });
    if (!verified) return res.redirect("/2fa/setup?error=invalid_code");

    await enableTwoFactor(req.user.id, tempSecret);
    req.session.temp2FASecret = null;
    if (req.session.user) req.session.user.is_2fa_enabled = 1;
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    const user = await getUserWithTwoFactorById(req.user.id);
    if (user?.email) {
      await sendMail({
        to: user.email,
        subject: "EduSphere 2FA enabled",
        html: `<p>Hi ${user.name || "Learner"}, your two-factor authentication has been enabled.</p>`,
      }).catch(() => null);
    }
    return res.redirect("/2fa/setup?enabled=1");
  } catch (err) {
    return next(err);
  }
};

const disable2FAForCurrentUser = async (req, res, next) => {
  try {
    if (!req.user?.id) return res.redirect("/login");
    await disableTwoFactor(req.user.id);
    if (req.session.user) req.session.user.is_2fa_enabled = 0;
    req.session.temp2FASecret = null;
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    return res.redirect("/2fa/setup?disabled=1");
  } catch (err) {
    return next(err);
  }
};

const signup = async (req, res, next) => {
  try {
    const { first_name, last_name, email, password } = req.body;
    if (!first_name || !last_name || !email || !password) {
      return res.status(400).render("signup", { error: "All fields are required." });
    }
    const existing = await getUserByEmail(email);
    if (existing) {
      return res.status(409).render("signup", { error: "An account with this email already exists." });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const name = `${first_name} ${last_name}`.trim();
    if (requireEmailVerification) {
      const verificationToken = crypto.randomBytes(24).toString("hex");
      await createUser(name, email, passwordHash, "student", verificationToken);
      await sendVerificationEmail(email, verificationToken, name);
      return res.redirect("/login?sent_verify=1");
    }

    const userId = await createUser(name, email, passwordHash, "student", null);
    await markEmailVerified(userId);
    return res.redirect("/login");
  } catch (err) {
    next(err);
  }
};

const resendVerification = async (req, res, next) => {
  try {
    if (!requireEmailVerification) return res.redirect("/login");
    const email = (req.body.email || "").trim();
    if (!email) return res.redirect("/login?resend_error=missing");
    const user = await getUserByEmail(email);
    if (!user) return res.redirect("/login?resend_error=not_found");
    if (user.email_verified) return res.redirect("/login?resend=already_verified");
    const token = crypto.randomBytes(24).toString("hex");
    await updateVerificationToken(user.id, token);
    await sendVerificationEmail(email, token, user.name);
    res.redirect("/login?resent=1");
  } catch (err) {
    next(err);
  }
};

const verifyEmail = async (req, res, next) => {
  try {
    if (!requireEmailVerification) return res.redirect("/login");
    const { token } = req.query;
    if (!token) return res.redirect("/login?verify_error=missing");
    const user = await getUserByVerificationToken(token);
    if (!user) return res.redirect("/login?verify_error=invalid");
    if (user.email_verified) return res.redirect("/login?verified=1");
    await markEmailVerified(user.id);
    res.redirect("/login?verified=1");
  } catch (err) {
    next(err);
  }
};

const requestPasswordReset = async (req, res, next) => {
  try {
    const email = (req.body.email || "").trim();
    if (!email) {
      return res.status(400).render("forgotPassword", { error: "Email is required.", info: null });
    }

    const user = await getUserByEmail(email);
    if (user) {
      const token = crypto.randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await setPasswordResetToken(user.id, token, expiresAt);
      await sendPasswordResetEmail(email, token, user.name);
    }

    return res.redirect("/forgot-password?sent=1");
  } catch (err) {
    return next(err);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const token = (req.body.token || "").trim();
    const password = req.body.password || "";
    const confirmPassword = req.body.confirm_password || "";

    if (!token) {
      return res.render("resetPassword", { error: "Invalid reset request.", token: null });
    }
    if (!password || password.length < 6) {
      return res.render("resetPassword", { error: "Password must be at least 6 characters.", token });
    }
    if (password !== confirmPassword) {
      return res.render("resetPassword", { error: "Passwords do not match.", token });
    }

    const user = await getUserByPasswordResetToken(token);
    if (!user || !user.password_reset_expires_at || new Date(user.password_reset_expires_at) < new Date()) {
      return res.render("resetPassword", { error: "This reset link is invalid or expired.", token: null });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await updatePasswordByUserId(user.id, passwordHash);
    return res.redirect("/login?password_reset=1");
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  showLogin,
  showSignup,
  showLogin2FA,
  verifyLogin2FA,
  show2FASetup,
  verify2FASetup,
  disable2FAForCurrentUser,
  showForgotPassword,
  showResetPassword,
  login,
  signup,
  resendVerification,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
};
