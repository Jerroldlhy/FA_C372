const express = require("express");
const courseController = require("../controllers/courseController");
const { authenticateToken } = require("../middleware/authMiddleware");
const {
  requireStudent,
  requireLecturerOrAdmin,
} = require("../middleware/roleMiddleware");

const router = express.Router();
const publicCourseRouter = express.Router();
const protectedCourseRouter = express.Router();

// Public course routes
publicCourseRouter.get("/", courseController.listCourses);
publicCourseRouter.get("/:id", courseController.getCourseDetails);

// Protected course routes
protectedCourseRouter.post(
  "/",
  authenticateToken,
  requireLecturerOrAdmin,
  courseController.createCourse
);

protectedCourseRouter.put(
  "/:id",
  authenticateToken,
  requireLecturerOrAdmin,
  courseController.updateCourse
);

protectedCourseRouter.delete(
  "/:id",
  authenticateToken,
  requireLecturerOrAdmin,
  courseController.deleteCourse
);

protectedCourseRouter.post(
  "/:id/enroll",
  authenticateToken,
  requireStudent,
  courseController.enrollCourse
);

protectedCourseRouter.get(
  "/:id/students",
  authenticateToken,
  requireLecturerOrAdmin,
  courseController.listCourseStudents
);

protectedCourseRouter.put(
  "/:id/progress",
  authenticateToken,
  requireStudent,
  courseController.updateMyCourseProgress
);

protectedCourseRouter.get(
  "/:id/progress",
  authenticateToken,
  requireStudent,
  courseController.getMyCourseProgress
);

protectedCourseRouter.post(
  "/:id/reviews",
  authenticateToken,
  requireStudent,
  courseController.addCourseReview
);

publicCourseRouter.get("/:id/reviews", courseController.listCourseReviews);

router.use("/", publicCourseRouter);
router.use("/", protectedCourseRouter);

module.exports = router;
