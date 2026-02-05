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
const { getSubscriptionByUser } = require("../models/subscriptionModel");
const { logUserActivity } = require("../models/userActivityModel");
const { getLatestOrderForUserCourse } = require("../models/orderModel");
const { sendMail } = require("../services/emailService");

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

const toDateLabel = (value) => {
  const dt = value ? new Date(value) : null;
  if (!dt || Number.isNaN(dt.getTime())) return new Date().toLocaleDateString();
  return dt.toLocaleDateString();
};

const buildCertificateMeta = (cert) => {
  const completionDate = cert.completed_at || cert.enrolled_at || new Date();
  const certificateNo = `EDS-${cert.enrollment_id}-${cert.course_id}-${cert.student_id}`;
  const safeCourse = String(cert.course_name || "course")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const fileName = `certificate-${safeCourse || "course"}.pdf`;
  return { completionDate, certificateNo, fileName };
};

const writeCertificateToDoc = (doc, cert, meta) => {
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
    `Completion date: ${toDateLabel(meta.completionDate)}    Instructor: ${cert.instructor_name || "TBA"}`,
    { align: "center" }
  );
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#6b7280").text(`Certificate No: ${meta.certificateNo}`, { align: "center" });
};

const buildCertificatePdfBuffer = async (cert, meta) =>
  new Promise((resolve, reject) => {
    if (!PDFDocument) return reject(new Error("pdfkit is unavailable"));
    const chunks = [];
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40 });
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    writeCertificateToDoc(doc, cert, meta);
    doc.end();
  });

const emailCertificateIfCompleted = async (userId, courseId, ipAddress) => {
  if (!PDFDocument) return;

  const cert = await getCompletedEnrollmentCertificateData(userId, courseId);
  if (!cert || !cert.student_email) return;

  const meta = buildCertificateMeta(cert);
  const pdfBuffer = await buildCertificatePdfBuffer(cert, meta);

  await sendMail({
    to: cert.student_email,
    subject: `Your EduSphere Certificate - ${cert.course_name}`,
    html: `
      <p>Hi ${cert.student_name || "Learner"},</p>
      <p>Congratulations on completing <strong>${cert.course_name}</strong>.</p>
      <p>Your certificate is attached to this email.</p>
      <p>Completion date: ${toDateLabel(meta.completionDate)}</p>
      <p>Certificate No: ${meta.certificateNo}</p>
    `,
    text: `Congratulations on completing ${cert.course_name}. Your certificate is attached. Certificate No: ${meta.certificateNo}`,
    attachments: [
      {
        filename: meta.fileName,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  await logUserActivity({
    userId,
    actorUserId: userId,
    activityType: "certificate_emailed",
    ipAddress,
    details: { courseId, certificateNo: meta.certificateNo },
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

    const [course, enrollment, order] = await Promise.all([
      getCourseById(courseId),
      getEnrollmentByStudentAndCourse(req.user.id, courseId),
      getLatestOrderForUserCourse(req.user.id, courseId),
    ]);

    if (!course) return res.status(404).render("404");
    if (String(course.subscription_model || "free").toLowerCase() === "pro") {
      const subscription = await getSubscriptionByUser(req.user.id);
      const hasAccess =
        subscription &&
        String(subscription.plan_code || "").toLowerCase() === "pro" &&
        String(subscription.status || "").toLowerCase() === "active";
      if (!hasAccess) {
        return res.redirect("/plans?subscription_error=pro_required");
      }
    }
    if (!enrollment) return res.redirect(`/courses/${courseId}?content_error=not_enrolled`);

    const progress = Math.max(0, Math.min(Number(enrollment.progress || 0), 100));
    const lessons = buildLessonItems(progress);
    const paidOrder = order && String(order.payment_status || "").toLowerCase() === "paid" ? order : null;
    const refundOrderId = paidOrder && Number(paidOrder.refunded_amount || 0) === 0 ? paidOrder.order_id : null;
    const refundEligible = progress === 0 && Boolean(refundOrderId);
    return res.render("courseLearning", {
      course,
      enrollment,
      progress,
      lessons,
      refundOrderId,
      refundEligible,
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

    const previousProgress = Number(enrollment.progress || 0);
    const targetProgress = Math.round((lessonNo / TOTAL_LESSONS) * 100);
    const nextProgress = Math.max(previousProgress, targetProgress);
    await updateEnrollmentProgress(req.user.id, courseId, nextProgress);

    if (previousProgress < 100 && nextProgress >= 100) {
      emailCertificateIfCompleted(req.user.id, courseId, req.ip).catch((err) => {
        console.error("Failed to email certificate:", err.message);
      });
      return res.redirect(`/learning/${courseId}?progress_updated=1&cert_emailed=1`);
    }

    return res.redirect(`/learning/${courseId}?progress_updated=1`);
  } catch (err) {
    return next(err);
  }
};

const downloadCertificate = async (req, res, next) => {
  try {
    const courseId = Number(req.params.courseId);
    if (!courseId) return res.redirect("/learning?error=invalid_course");
    if (!PDFDocument) return res.redirect(`/learning/${courseId}?cert_error=pdf_missing`);

    const cert = await getCompletedEnrollmentCertificateData(req.user.id, courseId);
    if (!cert) return res.redirect(`/learning/${courseId}?cert_error=not_completed`);

    const meta = buildCertificateMeta(cert);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${meta.fileName}"`);

    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40 });
    doc.pipe(res);
    writeCertificateToDoc(doc, cert, meta);
    doc.end();

    await logUserActivity({
      userId: req.user.id,
      actorUserId: req.user.id,
      activityType: "certificate_downloaded",
      ipAddress: req.ip,
      details: { courseId, certificateNo: meta.certificateNo },
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
