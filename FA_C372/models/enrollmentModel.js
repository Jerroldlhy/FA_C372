const pool = require("../db");
let completionColumnChecked = false;
let completionColumnAvailable = false;

const hasCompletionColumn = async () => {
  if (completionColumnChecked) return completionColumnAvailable;
  const [rows] = await pool.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'enrollments'
       AND COLUMN_NAME = 'completed_at'
     LIMIT 1`
  );
  completionColumnChecked = true;
  completionColumnAvailable = rows.length > 0;
  return completionColumnAvailable;
};

const ensureCompletionColumn = async () => {
  if (!(await hasCompletionColumn())) {
    await pool.query("ALTER TABLE enrollments ADD COLUMN completed_at DATETIME NULL");
    completionColumnChecked = true;
    completionColumnAvailable = true;
  }
};

const getEnrollmentsByStudent = async (studentId) => {
  const includeCompletedAt = await hasCompletionColumn();
  const [rows] = await pool.query(
    `SELECT e.id, e.progress, ${
      includeCompletedAt ? "e.completed_at" : "NULL AS completed_at"
    }, c.id AS course_id, c.course_name, c.category, c.price
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

const getEnrollmentByStudentAndCourse = async (studentId, courseId) => {
  const includeCompletedAt = await hasCompletionColumn();
  const [rows] = await pool.query(
    `SELECT id, course_id, student_id, progress, created_at, ${
      includeCompletedAt ? "completed_at" : "NULL AS completed_at"
    }
     FROM enrollments
     WHERE student_id = ? AND course_id = ?
     LIMIT 1`,
    [studentId, courseId]
  );
  return rows[0] || null;
};

const updateEnrollmentProgress = async (studentId, courseId, progress) => {
  const safeProgress = Math.max(0, Math.min(Number(progress) || 0, 100));
  if (await hasCompletionColumn()) {
    await pool.query(
      `UPDATE enrollments
       SET progress = ?,
           completed_at = CASE
             WHEN ? >= 100 THEN COALESCE(completed_at, NOW())
             ELSE completed_at
           END
       WHERE student_id = ? AND course_id = ?`,
      [safeProgress, safeProgress, studentId, courseId]
    );
    return;
  }
  await pool.query(
    `UPDATE enrollments
     SET progress = ?
     WHERE student_id = ? AND course_id = ?`,
    [safeProgress, studentId, courseId]
  );
};

const getCompletedEnrollmentCertificateData = async (studentId, courseId) => {
  const includeCompletedAt = await hasCompletionColumn();
  const [rows] = await pool.query(
    `SELECT
       e.id AS enrollment_id,
       e.course_id,
       e.student_id,
       e.progress,
       e.created_at AS enrolled_at,
       ${includeCompletedAt ? "e.completed_at" : "NULL AS completed_at"},
       c.course_name,
       c.category,
       c.created_at AS course_created_at,
       u.name AS student_name,
       u.email AS student_email,
       i.name AS instructor_name
     FROM enrollments e
     JOIN courses c ON c.id = e.course_id
     JOIN users u ON u.id = e.student_id
     LEFT JOIN users i ON i.id = c.instructor_id
     WHERE e.student_id = ? AND e.course_id = ?
     LIMIT 1`,
    [studentId, courseId]
  );
  const row = rows[0] || null;
  if (!row) return null;
  if (Number(row.progress || 0) < 100) return null;
  return row;
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

const getEnrollmentsByInstructorCourse = async (lecturerId) => {
  const [rows] = await pool.query(
    `SELECT c.id AS course_id, c.course_name, c.category, u.id AS student_id, u.name AS student_name,
            u.email, e.progress, e.created_at AS enrolled_at
     FROM enrollments e
     JOIN courses c ON e.course_id = c.id
     JOIN users u ON e.student_id = u.id
     WHERE c.instructor_id = ?
     ORDER BY c.course_name, e.created_at DESC`,
    [lecturerId]
  );
  return rows;
};

const getCompletionTrendForInstructor = async (lecturerId, limit = 6) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 6, 12));
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(e.created_at, '%Y-%m') AS period, AVG(e.progress) AS avg_progress
     FROM enrollments e
     JOIN courses c ON e.course_id = c.id
     WHERE c.instructor_id = ?
     GROUP BY period
     ORDER BY period DESC
     LIMIT ?`,
    [lecturerId, safeLimit]
  );
  return rows.map((row) => ({
    period: row.period,
    avg_progress: Number(row.avg_progress || 0),
  }));
};

const getEnrollmentTrendForInstructor = async (lecturerId, limit = 6) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 6, 12));
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(e.created_at, '%Y-%m') AS period, COUNT(*) AS enrollment_count
     FROM enrollments e
     JOIN courses c ON e.course_id = c.id
     WHERE c.instructor_id = ?
     GROUP BY period
     ORDER BY period DESC
     LIMIT ?`,
    [lecturerId, safeLimit]
  );
  return rows.map((row) => ({
    period: row.period,
    enrollment_count: Number(row.enrollment_count || 0),
  }));
};

const getStudentsForCourse = async (courseId) => {
  const [rows] = await pool.query(
    `SELECT e.student_id, u.name AS student_name, u.email
     FROM enrollments e
     JOIN users u ON e.student_id = u.id
     WHERE e.course_id = ?`,
    [courseId]
  );
  return rows;
};

const getRosterForInstructorCourse = async (lecturerId, courseId) => {
  const [rows] = await pool.query(
    `SELECT e.student_id, u.name AS student_name, u.email, e.progress, e.created_at AS enrolled_at
     FROM enrollments e
     JOIN courses c ON e.course_id = c.id
     JOIN users u ON e.student_id = u.id
     WHERE c.instructor_id = ? AND c.id = ?
     ORDER BY e.created_at DESC`,
    [lecturerId, courseId]
  );
  return rows;
};

module.exports = {
  ensureCompletionColumn,
  getEnrollmentsByStudent,
  isStudentEnrolled,
  createEnrollment,
  getEnrollmentsForLecturer,
  getDistinctStudentCount,
  getEnrollmentsByUserForAdmin,
  getEnrollmentsByInstructorCourse,
  getCompletionTrendForInstructor,
  getEnrollmentTrendForInstructor,
  getStudentsForCourse,
  getRosterForInstructorCourse,
  getEnrollmentByStudentAndCourse,
  updateEnrollmentProgress,
  getCompletedEnrollmentCertificateData,
};
