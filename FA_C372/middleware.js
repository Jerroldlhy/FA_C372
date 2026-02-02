const { authenticateToken } = require("./middleware/authMiddleware");
const {
  requireAdmin,
  requireLecturer,
  requireStudent,
  requireLecturerOrAdmin,
} = require("./middleware/roleMiddleware");

module.exports = {
  checkAuthenticated: authenticateToken,
  checkAdmin: requireAdmin,
  checkLecturer: requireLecturer,
  checkStudent: requireStudent,
  checkLecturerOrAdmin: requireLecturerOrAdmin,
};
