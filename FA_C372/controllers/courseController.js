const courseModel = require("../models/courseModel");
const courseService = require("../services/courseService");
const courseProgressModel = require("../models/courseProgressModel");
const reviewModel = require("../models/reviewModel");

const renderHome = async (req, res, next) => {
  try {
    const courses = await courseModel.listCourses({ limit: 100, offset: 0 });
    res.render("index", { courses });
  } catch (err) {
    next(err);
  }
};

const getCourseDetails = async (req, res, next) => {
  try {
    const course = await courseModel.findCourseById(req.params.id);
    if (!course) {
      if (req.accepts("html")) {
        return res.status(404).render("404");
      }
      return res.status(404).json({ error: "Course not found." });
    }
    if (req.accepts("html")) {
      return res.render("courseDetails", { course, status: req.query });
    }
    return res.status(200).json({ course: courseService.toCourseResponse(course) });
  } catch (err) {
    next(err);
  }
};

const listCourses = async (req, res, next) => {
  try {
    const { page, limit, offset } = courseService.parsePagination(req.query);

    const total = await courseModel.countCourses();
    const rows = await courseModel.listCourses({ limit, offset });

    const data = rows.map(courseService.toCourseResponse);

    return res.status(200).json({
      data,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

const createCourse = async (req, res, next) => {
  try {
    const {
      course_name,
      description,
      price,
      category,
      category_id,
      skill_level,
      language,
      learning_outcomes,
      resources,
      is_active,
      seats_available,
      instructor_id,
    } = req.body;
    if (!course_name || !price) {
      return res.status(400).json({ error: "course_name and price are required." });
    }

    const role = String(req.user.role || "").toLowerCase();
    const instructorId =
      role === "admin" && instructor_id ? Number(instructor_id) : Number(req.user.id);

    const courseId = await courseModel.createCourse({
      course_name,
      description,
      price,
      category,
      category_id,
      skill_level,
      language,
      learning_outcomes,
      resources,
      is_active,
      seats_available,
      instructor_id: instructorId,
    });

    return res.status(201).json({
      message: "Course created successfully.",
      course_id: courseId,
    });
  } catch (err) {
    next(err);
  }
};

const updateCourse = async (req, res, next) => {
  try {
    const courseId = req.params.id;
    const role = String(req.user.role || "").toLowerCase();
    if (role === "lecturer") {
      const ownsCourse = await courseModel.isCourseOwnedByInstructor(
        courseId,
        req.user.id
      );
      if (!ownsCourse) {
        return res.status(403).json({ error: "You can only update your own courses." });
      }
    }

    const {
      course_name,
      category,
      category_id,
      price,
      description,
      skill_level,
      language,
      learning_outcomes,
      resources,
      is_active,
      seats_available,
      instructor_id,
    } = req.body;
    await courseModel.updateCourse({
      course_id: courseId,
      course_name,
      category,
      category_id,
      price,
      description,
      skill_level,
      language,
      learning_outcomes,
      resources,
      is_active,
      seats_available,
      instructor_id: role === "admin" ? instructor_id : req.user.id,
    });

    return res.status(200).json({ message: "Course updated.", course_id: Number(courseId) });
  } catch (err) {
    next(err);
  }
};

const deleteCourse = async (req, res, next) => {
  try {
    const courseId = req.params.id;
    const role = String(req.user.role || "").toLowerCase();
    if (role === "lecturer") {
      const ownsCourse = await courseModel.isCourseOwnedByInstructor(
        courseId,
        req.user.id
      );
      if (!ownsCourse) {
        return res.status(403).json({ error: "You can only delete your own courses." });
      }
    }

    await courseModel.deleteCourse(courseId);
    return res.status(200).json({ message: "Course deleted.", course_id: Number(courseId) });
  } catch (err) {
    next(err);
  }
};

const listCourseStudents = async (req, res, next) => {
  try {
    const courseId = req.params.id;
    const course = await courseModel.findCourseById(courseId);
    if (!course) {
      return res.status(404).json({ error: "Course not found." });
    }

    const role = String(req.user.role || "").toLowerCase();
    if (role === "lecturer" && Number(course.instructor_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: "You can only view your own course students." });
    }

    const enrollments = await courseModel.listEnrollmentsByCourseId(courseId);
    return res.status(200).json({
      course_id: Number(courseId),
      students: enrollments,
    });
  } catch (err) {
    next(err);
  }
};

const enrollCourse = async (req, res, next) => {
  try {
    const courseId = req.params.id;
    const userId = req.user.id;

    const course = await courseModel.findCourseById(courseId);
    if (!course) {
      return res.status(404).json({ error: "Course not found." });
    }

    const existingEnrollment = await courseModel.findEnrollment({ courseId, userId });
    if (existingEnrollment) {
      return res.status(409).json({ error: "Student is already enrolled in this course." });
    }

    await courseModel.createEnrollment({ courseId, userId });

    return res.status(201).json({
      message: "Enrollment successful.",
      course_id: Number(courseId),
    });
  } catch (err) {
    next(err);
  }
};

const updateMyCourseProgress = async (req, res, next) => {
  try {
    const courseId = Number(req.params.id);
    const userId = Number(req.user.id);
    const progressPercent = Number(req.body.progress_percent);
    if (!Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100) {
      return res.status(400).json({ error: "progress_percent must be between 0 and 100." });
    }

    const enrollment = await courseModel.findEnrollment({ courseId, userId });
    if (!enrollment) {
      return res.status(403).json({ error: "Enroll in the course before updating progress." });
    }

    const status = progressPercent >= 100 ? "completed" : "in_progress";
    await courseProgressModel.upsertProgress({
      user_id: userId,
      course_id: courseId,
      progress_percent: progressPercent,
      status,
    });

    return res.status(200).json({
      message: "Progress updated.",
      course_id: courseId,
      progress_percent: progressPercent,
      status,
    });
  } catch (err) {
    next(err);
  }
};

const getMyCourseProgress = async (req, res, next) => {
  try {
    const courseId = Number(req.params.id);
    const userId = Number(req.user.id);
    const progress = await courseProgressModel.getProgress({
      user_id: userId,
      course_id: courseId,
    });
    return res.status(200).json({ progress: progress || null });
  } catch (err) {
    next(err);
  }
};

const addCourseReview = async (req, res, next) => {
  try {
    const courseId = Number(req.params.id);
    const userId = Number(req.user.id);
    const rating = Number(req.body.rating);
    const feedback = req.body.feedback || null;

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "rating must be an integer from 1 to 5." });
    }

    const enrollment = await courseModel.findEnrollment({ courseId, userId });
    if (!enrollment) {
      return res.status(403).json({ error: "Enroll in the course before reviewing." });
    }

    const review_id = await reviewModel.createReview({
      user_id: userId,
      course_id: courseId,
      rating,
      feedback,
    });
    return res.status(201).json({ message: "Review submitted.", review_id });
  } catch (err) {
    next(err);
  }
};

const listCourseReviews = async (req, res, next) => {
  try {
    const courseId = Number(req.params.id);
    const reviews = await reviewModel.listReviewsByCourse(courseId);
    return res.status(200).json({ reviews });
  } catch (err) {
    next(err);
  }
};

const adminCreateCourse = async (req, res, next) => {
  try {
    const {
      course_name,
      category,
      category_id,
      price,
      description,
      skill_level,
      language,
      learning_outcomes,
      resources,
      is_active,
      seats_available,
      instructor_id,
    } = req.body;
    if (!course_name || !price) {
      return res.redirect("/dashboard/admin?course_error=1");
    }
    await courseModel.createCourse({
      course_name,
      description,
      price,
      category,
      category_id,
      skill_level,
      language,
      learning_outcomes,
      resources,
      is_active,
      seats_available,
      instructor_id: instructor_id || null,
    });
    res.redirect("/dashboard/admin?course_created=1");
  } catch (err) {
    next(err);
  }
};

const adminUpdateCourse = async (req, res, next) => {
  try {
    const {
      course_name,
      category,
      category_id,
      price,
      description,
      skill_level,
      language,
      learning_outcomes,
      resources,
      is_active,
      seats_available,
      instructor_id,
    } = req.body;
    await courseModel.updateCourse({
      course_id: req.params.id,
      course_name,
      category,
      category_id,
      price,
      description,
      skill_level,
      language,
      learning_outcomes,
      resources,
      is_active,
      seats_available,
      instructor_id,
    });
    res.redirect("/dashboard/admin?course_updated=1");
  } catch (err) {
    next(err);
  }
};

const adminDeleteCourse = async (req, res, next) => {
  try {
    await courseModel.deleteCourse(req.params.id);
    res.redirect("/dashboard/admin?course_deleted=1");
  } catch (err) {
    next(err);
  }
};

module.exports = {
  renderHome,
  getCourseDetails,
  listCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  listCourseStudents,
  enrollCourse,
  updateMyCourseProgress,
  getMyCourseProgress,
  addCourseReview,
  listCourseReviews,
  adminCreateCourse,
  adminUpdateCourse,
  adminDeleteCourse,
};
