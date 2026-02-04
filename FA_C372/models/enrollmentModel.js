const pool = require("./db");

const getEnrollmentsByStudent = async (studentId) => {
  const [rows] = await pool.query(
    `SELECT e.id, e.progress, c.id AS course_id, c.course_name, c.category, c.price
     FROM enrollments e
     INNER JOIN courses c ON e.course_id = c.id
     WHERE e.student_id = ?
     ORDER BY c.course_name`,
    [studentId]
  );
  return rows;
};

const isStudentEnrolled = async (courseId, studentId) => {
  const [rows] = await pool.query(
    "SELECT id FROM enrollments WHERE course_id = ? AND student_id = ? LIMIT 1",
    [courseId, studentId]
  );
  return rows.length > 0;
};

const createEnrollment = async (courseId, studentId) => {
  await pool.query(
    "INSERT INTO enrollments (course_id, student_id) VALUES (?, ?)",
    [courseId, studentId]
  );
};

const getEnrollmentsForLecturer = async (lecturerId) => {
  const [rows] = await pool.query(
    `SELECT e.id, e.progress, c.course_name, u.name AS student_name
     FROM enrollments e
     JOIN courses c ON e.course_id = c.id
     JOIN users u ON e.student_id = u.id
     WHERE c.instructor_id = ?
     ORDER BY e.created_at DESC
     LIMIT 20`,
    [lecturerId]
  );
  return rows;
};

const getDistinctStudentCount = async (lecturerId) => {
  const [rows] = await pool.query(
    `SELECT COUNT(DISTINCT student_id) AS student_count
     FROM enrollments e
     JOIN courses c ON e.course_id = c.id
     WHERE c.instructor_id = ?`,
    [lecturerId]
  );
  return rows[0]?.student_count || 0;
};

const getEnrollmentsByUserForAdmin = async (userId) => {
  const [rows] = await pool.query(
    `SELECT e.id, e.progress, e.created_at, c.id AS course_id, c.course_name, c.category, c.price
     FROM enrollments e
     JOIN courses c ON e.course_id = c.id
     WHERE e.student_id = ?
     ORDER BY e.created_at DESC`,
    [userId]
  );
  return rows;
};

module.exports = {
  getEnrollmentsByStudent,
  isStudentEnrolled,
  createEnrollment,
  getEnrollmentsForLecturer,
  getDistinctStudentCount,
  getEnrollmentsByUserForAdmin,
};
