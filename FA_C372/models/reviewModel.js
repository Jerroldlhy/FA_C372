const pool = require("./db");

const getReviewsForCourses = async (courseIds) => {
  if (!courseIds.length) return [];
  const [rows] = await pool.query(
    `SELECT r.*, u.name AS student_name
     FROM course_reviews r
     JOIN users u ON r.student_id = u.id
     WHERE r.course_id IN (?)
     ORDER BY r.created_at DESC`,
    [courseIds]
  );
  return rows;
};

const upsertReview = async (courseId, studentId, rating, reviewText) => {
  await pool.query(
    `INSERT INTO course_reviews (course_id, student_id, rating, review)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE rating = VALUES(rating), review = VALUES(review), created_at = CURRENT_TIMESTAMP`,
    [courseId, studentId, rating, reviewText]
  );
};

const deleteReviewByInstructor = async (reviewId, instructorId) => {
  const [result] = await pool.query(
    `DELETE r FROM course_reviews r
     JOIN courses c ON r.course_id = c.id
     WHERE r.id = ? AND c.instructor_id = ?`,
    [reviewId, instructorId]
  );
  return result.affectedRows || 0;
};

module.exports = {
  getReviewsForCourses,
  upsertReview,
  deleteReviewByInstructor,
};
