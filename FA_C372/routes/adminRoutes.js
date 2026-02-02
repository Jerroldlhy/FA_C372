const express = require("express");
const adminController = require("../controllers/adminController");
const userController = require("../controllers/userController");
const courseController = require("../controllers/courseController");
const { authenticateToken } = require("../middleware/authMiddleware");
const { requireAdmin } = require("../middleware/roleMiddleware");

const router = express.Router();

router.get("/admin/dashboard", authenticateToken, requireAdmin, adminController.getDashboard);
router.get("/admin/users", authenticateToken, requireAdmin, userController.listUsersJson);
router.patch(
  "/admin/users/:id/role",
  authenticateToken,
  requireAdmin,
  userController.updateUserRole
);
router.delete("/admin/users/:id", authenticateToken, requireAdmin, userController.deleteUser);
router.post(
  "/admin/categories",
  authenticateToken,
  requireAdmin,
  adminController.createCategory
);
router.post("/admin/courses", authenticateToken, requireAdmin, courseController.adminCreateCourse);
router.post(
  "/admin/courses/:id/update",
  authenticateToken,
  requireAdmin,
  courseController.adminUpdateCourse
);
router.post(
  "/admin/courses/:id/delete",
  authenticateToken,
  requireAdmin,
  courseController.adminDeleteCourse
);

module.exports = router;
