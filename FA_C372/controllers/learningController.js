const { getEnrollmentsByStudent, getEnrollmentByStudentAndCourse, updateEnrollmentProgress } = require("../models/enrollmentModel");
const { getCourseById } = require("../models/courseModel");

const TOTAL_LESSONS = 5;

const buildLessonItems = (progress) => {
  const safeProgress = Math.max(0, Math.min(Number(progress) || 0, 100));
  const completedCount = Math.floor((safeProgress / 100) * TOTAL_LESSONS);
  return Array.from({ length: TOTAL_LESSONS }, (_, idx) => {
    const lessonNo = idx + 1;
    return {
      lessonNo,
      title: `Lesson ${lessonNo}`,
      completed: lessonNo <= completedCount,
    };
  });
};

const myLearning = async (req, res, next) => {
  try {
    const enrollments = await getEnrollmentsByStudent(req.user.id);
    return res.render("myLearning", { enrollments, status: req.query });
  } catch (err) {
    return next(err);
  }
};

const courseLearning = async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    if (!courseId) return res.redirect("/learning?error=invalid_course");

    const [course, enrollment] = await Promise.all([
      getCourseById(courseId),
      getEnrollmentByStudentAndCourse(req.user.id, courseId),
    ]);

    if (!course) return res.status(404).render("404");
    if (!enrollment) return res.redirect(`/courses/${courseId}?content_error=not_enrolled`);

    const progress = Math.max(0, Math.min(Number(enrollment.progress || 0), 100));
    const lessons = buildLessonItems(progress);
    return res.render("courseLearning", {
      course,
      enrollment,
      progress,
      lessons,
      status: req.query,
    });
  } catch (err) {
    return next(err);
  }
};

const completeLesson = async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    const lessonNo = Number(req.params.lessonNo);
    if (!courseId || !lessonNo || lessonNo < 1 || lessonNo > TOTAL_LESSONS) {
      return res.redirect("/learning?error=invalid_lesson");
    }

    const enrollment = await getEnrollmentByStudentAndCourse(req.user.id, courseId);
    if (!enrollment) return res.redirect(`/courses/${courseId}?content_error=not_enrolled`);

    const targetProgress = Math.round((lessonNo / TOTAL_LESSONS) * 100);
    const nextProgress = Math.max(Number(enrollment.progress || 0), targetProgress);
    await updateEnrollmentProgress(req.user.id, courseId, nextProgress);
    return res.redirect(`/learning/${courseId}?progress_updated=1`);
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  myLearning,
  courseLearning,
  completeLesson,
};
