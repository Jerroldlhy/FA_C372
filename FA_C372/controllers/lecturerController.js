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

    await createAnnouncement({
      courseId,
      lecturerId: req.user.id,
      title,
      message,
    });

    const students = await getStudentsForCourse(courseId);
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

module.exports = {
  sendCourseAnnouncement,
};
