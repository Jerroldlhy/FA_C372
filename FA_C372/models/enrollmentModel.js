const pool = require("./db");

const createEnrollment = async ({ user_id, course_id }) => {
  const [result] = await pool.query(
    "INSERT INTO enrollments (user_id, course_id) VALUES (?, ?)",
    [user_id, course_id]
  );
  return result.insertId;
};

const findEnrollment = async ({ user_id, course_id }) => {
  const [rows] = await pool.query(
    `SELECT enrollment_id
     FROM enrollments
     WHERE user_id = ? AND course_id = ?
     LIMIT 1`,
    [user_id, course_id]
  );
  return rows[0] || null;
};

const listByUserId = async (userId) => {
  const [rows] = await pool.query(
    `SELECT e.enrollment_id, e.enrollment_date, c.course_id, c.course_name, c.category
     FROM enrollments e
     INNER JOIN courses c ON e.course_id = c.course_id
     WHERE e.user_id = ?
     ORDER BY e.enrollment_date DESC`,
    [userId]
  );
  return rows;
};

module.exports = {
  createEnrollment,
  findEnrollment,
  listByUserId,
};
