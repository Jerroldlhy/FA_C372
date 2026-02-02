const express = require("express");
const userController = require("../controllers/userController");
const { authenticateToken } = require("../middleware/authMiddleware");
const {
  requireAdmin,
  requireLecturer,
  requireStudent,
} = require("../middleware/roleMiddleware");

const router = express.Router();
const authRouter = express.Router();
const dashboardRouter = express.Router();

// Auth routes
authRouter.get("/login", userController.renderLogin);
authRouter.get("/signup", userController.renderSignup);
authRouter.post("/logout", userController.logout);

// Dashboard routes
dashboardRouter.get(
  "/dashboard/student",
  authenticateToken,
  requireStudent,
  userController.getStudentDashboard
);

dashboardRouter.get(
  "/dashboard/lecturer",
  authenticateToken,
  requireLecturer,
  userController.getLecturerDashboard
);

dashboardRouter.get(
  "/dashboard/admin",
  authenticateToken,
  requireAdmin,
  userController.getAdminDashboard
);

router.get("/users/me", authenticateToken, userController.getCurrentUser);

router.use("/", authRouter);
router.use("/", dashboardRouter);

module.exports = router;
