const pool = require("./db");

const listCourses = async ({ limit, offset }) => {
  const [rows] = await pool.query(
    `SELECT c.course_id, c.course_name, c.description, c.price,
            COALESCE(cc.category_name, c.category) AS category,
            c.category_id,
            c.skill_level, c.language, c.learning_outcomes, c.resources,
            c.is_active, c.seats_available,
            CONCAT(u.first_name, ' ', u.last_name) AS instructor_name,
            u.username AS instructor_username
     FROM courses c
     LEFT JOIN course_categories cc ON c.category_id = cc.category_id
     LEFT JOIN users u ON c.instructor_id = u.user_id
     ORDER BY c.course_name ASC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return rows;
};

const countCourses = async () => {
  const [[row]] = await pool.query("SELECT COUNT(*) AS total FROM courses");
  return row.total || 0;
};

const findCourseById = async (courseId) => {
  const [rows] = await pool.query(
    `SELECT c.course_id, c.course_name, c.description, c.price,
            COALESCE(cc.category_name, c.category) AS category,
            c.category_id,
            c.skill_level, c.language, c.learning_outcomes, c.resources,
            c.is_active, c.seats_available,
            c.instructor_id,
            CONCAT(u.first_name, ' ', u.last_name) AS instructor_name,
            u.username AS instructor_username
     FROM courses c
     LEFT JOIN course_categories cc ON c.category_id = cc.category_id
     LEFT JOIN users u ON c.instructor_id = u.user_id
     WHERE c.course_id = ?
     LIMIT 1`,
    [courseId]
  );
  return rows[0] || null;
};

const createCourse = async ({
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
}) => {
  const [result] = await pool.query(
    `INSERT INTO courses
      (course_name, description, price, category, category_id, skill_level, language, learning_outcomes, resources, is_active, seats_available, instructor_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      course_name,
      description || null,
      price,
      category || null,
      category_id || null,
      skill_level || null,
      language || null,
      learning_outcomes || null,
      resources || null,
      typeof is_active === "undefined" ? 1 : (is_active ? 1 : 0),
      typeof seats_available === "undefined" ? null : seats_available,
      instructor_id,
    ]
  );
  return result.insertId;
};

const updateCourse = async ({
  course_id,
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
}) => {
  await pool.query(
    `UPDATE courses
     SET course_name = ?, category = ?, category_id = ?, price = ?, description = ?,
         skill_level = ?, language = ?, learning_outcomes = ?, resources = ?,
         is_active = ?, seats_available = ?, instructor_id = ?
     WHERE course_id = ?`,
    [
      course_name,
      category || null,
      category_id || null,
      price,
      description || null,
      skill_level || null,
      language || null,
      learning_outcomes || null,
      resources || null,
      typeof is_active === "undefined" ? 1 : (is_active ? 1 : 0),
      typeof seats_available === "undefined" ? null : seats_available,
      instructor_id || null,
      course_id,
    ]
  );
};

const deleteCourse = async (course_id) => {
  await pool.query("DELETE FROM courses WHERE course_id = ?", [course_id]);
};

const isCourseOwnedByInstructor = async (courseId, instructorId) => {
  const [[row]] = await pool.query(
    "SELECT COUNT(*) AS match_count FROM courses WHERE course_id = ? AND instructor_id = ?",
    [courseId, instructorId]
  );
  return Number(row.match_count) > 0;
};

const listEnrollmentsByUserId = async (userId) => {
  const [rows] = await pool.query(
    `SELECT e.enrollment_id, c.course_id, c.course_name, c.category, c.price
     FROM enrollments e
     INNER JOIN courses c ON e.course_id = c.course_id
     WHERE e.user_id = ?
     ORDER BY c.course_name`,
    [userId]
  );
  return rows;
};

const findEnrollment = async ({ courseId, userId }) => {
  const [rows] = await pool.query(
    `SELECT enrollment_id
     FROM enrollments
     WHERE course_id = ? AND user_id = ?
     LIMIT 1`,
    [courseId, userId]
  );
  return rows[0] || null;
};

const createEnrollment = async ({ courseId, userId }) => {
  const [result] = await pool.query(
    "INSERT INTO enrollments (course_id, user_id) VALUES (?, ?)",
    [courseId, userId]
  );
  return result.insertId;
};

const listEnrollmentsByCourseId = async (courseId) => {
  const [rows] = await pool.query(
    `SELECT e.enrollment_id, e.enrollment_date, u.user_id, u.username, u.email
     FROM enrollments e
     INNER JOIN users u ON e.user_id = u.user_id
     WHERE e.course_id = ?
     ORDER BY e.enrollment_date DESC`,
    [courseId]
  );
  return rows;
};

const countEnrollments = async () => {
  const [[row]] = await pool.query(
    "SELECT COUNT(*) AS total_enrollments FROM enrollments"
  );
  return row.total_enrollments || 0;
};

module.exports = {
  listCourses,
  countCourses,
  findCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  isCourseOwnedByInstructor,
  listEnrollmentsByUserId,
  findEnrollment,
  createEnrollment,
  listEnrollmentsByCourseId,
  countEnrollments,
};
