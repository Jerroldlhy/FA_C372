const {
  getCoursesWithStats,
  getCourseFilterOptions,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
} = require("../models/courseModel");
const { getLecturers, isLecturerId } = require("../models/userModel");
const { getReviewsForCourses, upsertReview } = require("../models/reviewModel");
const { getEnrollmentsByStudent, isStudentEnrolled } = require("../models/enrollmentModel");
const { getWalletBalance } = require("../models/walletModel");
const {
  enrollStudentWithPayment,
  WalletError,
  ExternalCheckoutRequiredError,
} = require("../models/paymentModel");
const { getCartItemsForUser } = require("../models/cartModel");
const { logUserActivity } = require("../models/userActivityModel");

const normalizeActiveFlag = (value, fallback = 1) => {
  if (Array.isArray(value)) {
    value = value[value.length - 1];
  }
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).toLowerCase();
  if (["1", "true", "on"].includes(normalized)) return 1;
  if (["0", "false", "off"].includes(normalized)) return 0;
  return fallback;
};

const isPublishedCourse = (course) => course && course.is_active !== 0;

const listCourses = async (req, res, next) => {
  try {
    const role = req.user?.role ? String(req.user.role).toLowerCase() : "";
    if (role === "admin") return res.redirect("/dashboard/admin");
    if (role === "lecturer") return res.redirect("/dashboard/lecturer");

    const filters = {
      q: (req.query.q || "").trim(),
      category: (req.query.category || "").trim(),
      level: (req.query.level || "").trim(),
      language: (req.query.language || "").trim(),
      minPrice: req.query.min_price || "",
      maxPrice: req.query.max_price || "",
    };

    const courses = await getCoursesWithStats(filters);
    const filterOptions = await getCourseFilterOptions();
    const courseIds = courses.map((c) => c.id);
    const reviewsMap = {};
    if (courseIds.length) {
      const reviewRows = await getReviewsForCourses(courseIds);
      reviewRows.forEach((review) => {
        if (!reviewsMap[review.course_id]) {
          reviewsMap[review.course_id] = [];
        }
        reviewsMap[review.course_id].push(review);
      });
    }
    const lecturers = await getLecturers();
    let enrolledCourseIds = [];
    let walletBalance = 0;
    let cartCourseIds = [];
    if (req.user && req.user.role === "student") {
      const enrollments = await getEnrollmentsByStudent(req.user.id);
      enrolledCourseIds = enrollments.map((row) => row.course_id);
      walletBalance = await getWalletBalance(req.user.id);
      const cartItems = await getCartItemsForUser(req.user.id);
      cartCourseIds = cartItems.map((row) => Number(row.course_id));
    }
    res.render("courses", {
      courses,
      reviewsMap,
      enrolledCourseIds,
      cartCourseIds,
      walletBalance,
      lecturers,
      filters,
      filterOptions,
      status: req.query,
    });
  } catch (err) {
    next(err);
  }
};

const getCourseDetails = async (req, res, next) => {
  try {
    const course = await getCourseById(req.params.id);
    if (!course) return res.status(404).render("404");
    const viewerRole = req.user?.role ? String(req.user.role).toLowerCase() : "";
    const currentUserId = req.user ? Number(req.user.id) : null;
    const ownsCourse =
      Boolean(currentUserId) &&
      course.instructor_id &&
      Number(course.instructor_id) === currentUserId;
    const canPreviewDraft = viewerRole === "admin" || (viewerRole === "lecturer" && ownsCourse);
    if (!isPublishedCourse(course) && !canPreviewDraft) {
      return res.status(404).render("404");
    }

    let enrolled = false;
    let inCart = false;
    const isStudent = viewerRole === "student";
    if (isStudent) {
      enrolled = await isStudentEnrolled(course.id, req.user.id);
      const cartItems = await getCartItemsForUser(req.user.id);
      inCart = cartItems.some((item) => Number(item.course_id) === Number(course.id));
    }

    res.render("courseDetails", {
      course,
      status: req.query,
      isStudent,
      enrolled,
      inCart,
    });
  } catch (err) {
    next(err);
  }
};

const handleCreateCourse = async (req, res, next) => {
  try {
    const { course_name, price, category, description, level, language, instructor_id } = req.body;
    if (!course_name || !price) return res.redirect("/courses?course_error=missing");
    const role = (req.user.role || "").toLowerCase();
    let assignedInstructor = null;
    if (role === "lecturer") assignedInstructor = req.user.id;
    else if (instructor_id && (await isLecturerId(instructor_id))) assignedInstructor = instructor_id;
    await createCourse({
      course_name,
      description,
      price,
      category,
      level,
      language,
      stock_qty: 0,
      instructor_id: assignedInstructor,
    });
    const redirectBase = req.body.redirect_to === "lecturer_dashboard" ? "/dashboard/lecturer" : "/courses";
    res.redirect(`${redirectBase}?course_created=1`);
  } catch (err) {
    next(err);
  }
};

const handleUpdateCourse = async (req, res, next) => {
  try {
    const { course_name, price, category, description, level, language } = req.body;
    const course = await getCourseById(req.params.id);
    if (!course) return res.redirect("/courses?course_error=not_found");
    const role = (req.user.role || "").toLowerCase();
    if (role === "lecturer" && course.instructor_id !== req.user.id) return res.status(403).send("Forbidden");
    let assignedInstructor = course.instructor_id;
    if (role === "admin" && req.body.instructor_id && (await isLecturerId(req.body.instructor_id))) {
      assignedInstructor = req.body.instructor_id;
    }
    const fallbackActiveState = course.is_active === 0 ? 0 : 1;
    const normalizedIsActive = normalizeActiveFlag(req.body.is_active, fallbackActiveState);
    await updateCourse(req.params.id, {
      course_name: course_name || course.course_name,
      price: price || course.price,
      category,
      description,
      level,
      language,
      stock_qty: 0,
      instructor_id: assignedInstructor,
      is_active: normalizedIsActive,
    });
    const redirectBase = req.body.redirect_to === "lecturer_dashboard" ? "/dashboard/lecturer" : "/courses";
    res.redirect(`${redirectBase}?course_updated=1`);
  } catch (err) {
    next(err);
  }
};

const handleDeleteCourse = async (req, res, next) => {
  try {
    const course = await getCourseById(req.params.id);
    if (!course) return res.redirect("/courses?course_error=not_found");
    const role = (req.user.role || "").toLowerCase();
    if (role === "lecturer" && course.instructor_id !== req.user.id) return res.status(403).send("Forbidden");
    await deleteCourse(req.params.id);
    res.redirect("/courses?course_deleted=1");
  } catch (err) {
    next(err);
  }
};

const handleReview = async (req, res, next) => {
  try {
    const courseId = req.params.id;
    const course = await getCourseById(courseId);
    if (!course || !isPublishedCourse(course)) {
      return res.redirect("/courses?review_error=course_unpublished");
    }
    const enrolled = await isStudentEnrolled(courseId, req.user.id);
    if (!enrolled) return res.redirect("/courses?review_error=not_enrolled");
    let rating = Number(req.body.rating || 0);
    if (!rating || rating < 1) rating = 1;
    if (rating > 5) rating = 5;
    await upsertReview(courseId, req.user.id, rating, req.body.review || null);
    res.redirect("/courses?review_success=1");
  } catch (err) {
    next(err);
  }
};

const handleEnroll = async (req, res, next) => {
  const courseId = req.params.id;
  const paymentMethod = (req.body.payment_method || "wallet").toLowerCase();
  try {
    const course = await getCourseById(courseId);
    if (!course) return res.redirect("/courses?enroll_error=course_missing");
    if (!isPublishedCourse(course)) {
      return res.redirect("/courses?enroll_error=course_unpublished");
    }
    const price = Number(course.price);
    if (price < 0) return res.redirect("/courses?enroll_error=invalid_price");
    const enrolled = await isStudentEnrolled(courseId, req.user.id);
    if (enrolled) return res.redirect("/courses?enroll_error=already_enrolled");
    await enrollStudentWithPayment(courseId, req.user.id, price, paymentMethod);
    await logUserActivity({
      userId: req.user.id,
      actorUserId: req.user.id,
      activityType: "course_enrolled",
      ipAddress: req.ip,
      details: { courseId: Number(courseId), courseName: course.course_name },
    });
    return res.redirect("/courses?enrolled=1");
  } catch (err) {
    if (err instanceof WalletError) {
      return res.redirect("/courses?enroll_error=wallet_balance");
    }
    if (err instanceof ExternalCheckoutRequiredError) {
      return res.redirect("/courses?enroll_error=external_checkout");
    }
    next(err);
  }
};

module.exports = {
  listCourses,
  getCourseDetails,
  handleCreateCourse,
  handleUpdateCourse,
  handleDeleteCourse,
  handleReview,
  handleEnroll,
};
