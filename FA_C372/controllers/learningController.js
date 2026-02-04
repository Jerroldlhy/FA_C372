let PDFDocument = null;
try {
  PDFDocument = require("pdfkit");
} catch (err) {
  PDFDocument = null;
}

const {
  getEnrollmentsByStudent,
  getEnrollmentByStudentAndCourse,
  updateEnrollmentProgress,
  getCompletedEnrollmentCertificateData,
} = require("../models/enrollmentModel");
const { getCourseById } = require("../models/courseModel");
const { logUserActivity } = require("../models/userActivityModel");

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

const toDateLabel = (value) => {
  const dt = value ? new Date(value) : null;
  if (!dt || Number.isNaN(dt.getTime())) return new Date().toLocaleDateString();
  return dt.toLocaleDateString();
};

const downloadCertificate = async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    if (!courseId) return res.redirect("/learning?error=invalid_course");
    if (!PDFDocument) return res.redirect(`/learning/${courseId}?cert_error=pdf_missing`);

    const cert = await getCompletedEnrollmentCertificateData(req.user.id, courseId);
    if (!cert) return res.redirect(`/learning/${courseId}?cert_error=not_completed`);

    const completionDate = cert.completed_at || cert.enrolled_at || new Date();
    const certificateNo = `EDS-${cert.enrollment_id}-${cert.course_id}-${cert.student_id}`;
    const safeCourse = String(cert.course_name || "course")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
    const fileName = `certificate-${safeCourse || "course"}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40 });
    doc.pipe(res);

    doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).lineWidth(2).stroke("#6f4cf5");
    doc.moveDown(2);
    doc.fontSize(14).fillColor("#4d5d7a").text("EDUSPHERE", { align: "center" });
    doc.moveDown(0.6);
    doc.fontSize(36).fillColor("#111827").text("Certificate of Completion", { align: "center" });
    doc.moveDown(1.2);
    doc.fontSize(16).fillColor("#4d5d7a").text("This certifies that", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(30).fillColor("#111827").text(cert.student_name || "Student", { align: "center" });
    doc.moveDown(0.9);
    doc.fontSize(16).fillColor("#4d5d7a").text("has successfully completed the course", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(26).fillColor("#111827").text(cert.course_name || "Course", { align: "center" });
    doc.moveDown(1.1);
    doc.fontSize(12).fillColor("#4d5d7a").text(
      `Completion date: ${toDateLabel(completionDate)}    Instructor: ${cert.instructor_name || "TBA"}`,
      { align: "center" }
    );
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#6b7280").text(`Certificate No: ${certificateNo}`, { align: "center" });

    doc.end();

    await logUserActivity({
      userId: req.user.id,
      actorUserId: req.user.id,
      activityType: "certificate_downloaded",
      ipAddress: req.ip,
      details: { courseId, certificateNo },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  myLearning,
  courseLearning,
  completeLesson,
  downloadCertificate,
};
