const userModel = require("../models/userModel");
const courseModel = require("../models/courseModel");
const walletModel = require("../models/walletModel");
const transactionModel = require("../models/transactionModel");
const authService = require("../services/authService");

const signup = async (req, res, next) => {
  try {
    const { username, email, password, role } = req.body;
    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ error: "username, email, and password are required." });
    }

    const existing = await userModel.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const hashed = await authService.hashPassword(password);
    const finalRole = authService.normalizeRole(role, "student");

    const userId = await userModel.createUser({
      username,
      email,
      password: hashed,
      role: finalRole,
    });

    const token = authService.signAuthToken({
      userId,
      role: finalRole,
      expiresIn: "2h",
    });

    return res.status(201).json({ token });
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const user = await userModel.findByEmail(email);
    if (!user) {
      return res.status(400).json({ error: "Invalid email or password." });
    }

    const isValid = await authService.comparePassword(password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: "Invalid email or password." });
    }

    const token = authService.signAuthToken({
      userId: user.user_id,
      role: user.role,
      expiresIn: "1h",
    });
    res.cookie("token", token, { httpOnly: true });

    return res.status(200).json({
      token,
      user: { user_id: user.user_id, role: user.role },
    });
  } catch (err) {
    next(err);
  }
};

const logout = (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
};

const renderLogin = (req, res) => {
  res.render("login", { error: null });
};

const renderSignup = (req, res) => {
  res.render("signup");
};

const getStudentDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const enrollments = await courseModel.listEnrollmentsByUserId(userId);
    const walletBalance = await walletModel.getBalanceByUserId(userId);
    const transactions = await transactionModel.listByUserId(userId);

    res.render("dashboard", {
      enrollments,
      walletBalance,
      transactions,
      status: req.query,
    });
  } catch (err) {
    next(err);
  }
};

const getLecturerDashboard = (req, res) => {
  res.render("dashboard", {
    enrollments: [],
    walletBalance: 0,
    transactions: [],
    status: req.query || {},
  });
};

const getAdminDashboard = async (req, res, next) => {
  try {
    const users = await userModel.listUsers();
    const courses = await courseModel.listCourses({ limit: 100, offset: 0 });
    const transactions = await transactionModel.listAll();
    res.render("adminDashboard", {
      users,
      courses,
      transactions,
      status: req.query,
    });
  } catch (err) {
    next(err);
  }
};

const getAdminDashboardJson = async (req, res, next) => {
  try {
    const role = req.query.role ? String(req.query.role).toLowerCase() : null;
    const roleFilter = ["student", "lecturer", "admin"].includes(role)
      ? role
      : null;

    const users = await userModel.listUsers(roleFilter);
    const totalCourses = await courseModel.countCourses();
    const totalEnrollments = await courseModel.countEnrollments();
    const totalTransactions = await transactionModel.countTransactions();

    return res.status(200).json({
      users,
      totals: {
        courses: totalCourses,
        enrollments: totalEnrollments,
        transactions: totalTransactions,
      },
      filter: { role: roleFilter },
    });
  } catch (err) {
    next(err);
  }
};

const getCurrentUser = async (req, res, next) => {
  try {
    const user = await userModel.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    return res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
};

const listUsersJson = async (req, res, next) => {
  try {
    const role = req.query.role ? String(req.query.role).toLowerCase() : null;
    const roleFilter = ["student", "lecturer", "admin"].includes(role)
      ? role
      : null;
    const users = await userModel.listUsers(roleFilter);
    return res.status(200).json({ users, filter: { role: roleFilter } });
  } catch (err) {
    next(err);
  }
};

const updateUserRole = async (req, res, next) => {
  try {
    const role = authService.normalizeRole(req.body.role, null);
    if (!role) {
      return res.status(400).json({ error: "Invalid role." });
    }
    await userModel.updateUserRole(req.params.id, role);
    return res.status(200).json({ message: "User role updated.", role });
  } catch (err) {
    next(err);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    await userModel.deleteUserById(req.params.id);
    return res.status(200).json({ message: "User deleted." });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  renderLogin,
  renderSignup,
  signup,
  login,
  logout,
  getStudentDashboard,
  getLecturerDashboard,
  getAdminDashboard,
  getAdminDashboardJson,
  getCurrentUser,
  listUsersJson,
  updateUserRole,
  deleteUser,
};
