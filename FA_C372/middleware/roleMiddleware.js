const requireRole = (...allowedRoles) => (req, res, next) => {
  const role = req.user && req.user.role ? String(req.user.role).toLowerCase() : "";
  if (!allowedRoles.includes(role)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
};

const requireAdmin = requireRole("admin");
const requireLecturer = requireRole("lecturer");
const requireStudent = requireRole("student");
const requireLecturerOrAdmin = requireRole("lecturer", "admin");

module.exports = {
  requireRole,
  requireAdmin,
  requireLecturer,
  requireStudent,
  requireLecturerOrAdmin,
};
