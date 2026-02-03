const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const {
  getUserByEmail,
  createUser,
  updateVerificationToken,
  markEmailVerified,
  getUserByVerificationToken,
} = require("../models/userModel");
const { sendVerificationEmail } = require("../services/emailService");

const showLogin = (req, res) => {
  res.render("login", { error: null, info: req.query });
};

const showSignup = (req, res) => {
  res.render("signup", { error: null });
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
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!user.email_verified) {
      return res
        .status(403)
        .render("login", { error: "Please verify your email before logging in.", info: { pending_verification: true } });
    }
    if (!isValid) {
      return res.status(401).render("login", { error: "Invalid email or password.", info: null });
    }
    req.session.user = { id: user.id, role: user.role, name: user.name };
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    const role = (user.role || "").toLowerCase();
    if (role === "admin") return res.redirect("/dashboard/admin");
    if (role === "lecturer") return res.redirect("/dashboard/lecturer");
    return res.redirect("/dashboard/student");
  } catch (err) {
    next(err);
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
    const verificationToken = crypto.randomBytes(24).toString("hex");
    await createUser(name, email, passwordHash, "student", verificationToken);
    await sendVerificationEmail(email, verificationToken, name);
    return res.redirect("/login?sent_verify=1");
  } catch (err) {
    next(err);
  }
};

const resendVerification = async (req, res, next) => {
  try {
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

const googleRedirect = (req, res) => {
  res.redirect("/login?social_unavailable=1");
};

module.exports = {
  showLogin,
  showSignup,
  login,
  signup,
  resendVerification,
  verifyEmail,
  googleRedirect,
};
