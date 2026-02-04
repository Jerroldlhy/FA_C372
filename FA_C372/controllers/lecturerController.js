const { getCourseById } = require("../models/courseModel");
const { createAnnouncement } = require("../models/announcementModel");
const { getStudentsForCourse } = require("../models/enrollmentModel");
const { logUserActivity } = require("../models/userActivityModel");

const sendCourseAnnouncement = async (req, res, next) => {
  try {
    const courseId = req.validated?.courseId || Number(req.params.id);
    const course = await getCourseById(courseId);
    if (!course || Number(course.instructor_id) !== Number(req.user.id)) {
      return res.status(403).send("Forbidden");
    }

    const title = req.body.title;
    const message = req.body.message;

    const students = await getStudentsForCourse(courseId);
    await createAnnouncement({
      courseId,
      lecturerId: req.user.id,
      title,
      message,
      recipientCount: students.length,
    });

    await Promise.all(
      students.map((student) =>
        logUserActivity({
          userId: student.student_id,
          actorUserId: req.user.id,
          activityType: "course_announcement",
          ipAddress: req.ip,
          details: {
            courseId,
            courseName: course.course_name,
            title,
          },
        })
      )
    );

    return res.redirect("/dashboard/lecturer?announcement_sent=1");
  } catch (err) {
    next(err);
  }
};

const csvEscape = (value) => {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const exportCourseRoster = async (req, res, next) => {
  try {
    const courseId = req.validated?.courseId || Number(req.params.id);
    const course = await getCourseById(courseId);
    if (!course || Number(course.instructor_id) !== Number(req.user.id)) {
      return res.status(403).send("Forbidden");
    }

    const students = await getStudentsForCourse(courseId);
    const lines = [];
    lines.push("Course Roster");
    lines.push(`Course,${csvEscape(course.course_name || "Untitled")}`);
    lines.push(`Exported At,${new Date().toISOString()}`);
    lines.push("");
    lines.push("Student Name,Email");
    students.forEach((student) => {
      lines.push([csvEscape(student.student_name), csvEscape(student.email)].join(","));
    });

    const filenameSafeName = String(course.course_name || "course")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="roster-${filenameSafeName}.csv"`);
    return res.send(lines.join("\n"));
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  sendCourseAnnouncement,
  exportCourseRoster,
};
