const pool = require("./db");

const createReview = async ({ user_id, course_id, rating, feedback }) => {
  const [result] = await pool.query(
    `INSERT INTO reviews (user_id, course_id, rating, feedback)
     VALUES (?, ?, ?, ?)`,
    [user_id, course_id, rating, feedback || null]
  );
  return result.insertId;
};

const listReviewsByCourse = async (courseId) => {
  const [rows] = await pool.query(
    `SELECT r.review_id, r.rating, r.feedback, r.created_at, u.user_id, u.username
     FROM reviews r
     INNER JOIN users u ON r.user_id = u.user_id
     WHERE r.course_id = ?
     ORDER BY r.created_at DESC`,
    [courseId]
  );
  return rows;
};

module.exports = {
  createReview,
  listReviewsByCourse,
};
