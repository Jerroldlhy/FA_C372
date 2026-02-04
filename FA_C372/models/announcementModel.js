const pool = require("./db");

const ensureAnnouncementsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_announcements (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      course_id INT NOT NULL,
      lecturer_id INT NOT NULL,
      title VARCHAR(150) NOT NULL,
      message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_announcements_course (course_id),
      INDEX idx_announcements_lecturer (lecturer_id),
      CONSTRAINT fk_announcements_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
      CONSTRAINT fk_announcements_lecturer FOREIGN KEY (lecturer_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
};

const createAnnouncement = async ({ courseId, lecturerId, title, message }) => {
  const [result] = await pool.query(
    `INSERT INTO course_announcements (course_id, lecturer_id, title, message)
     VALUES (?, ?, ?, ?)`,
    [courseId, lecturerId, title, message || null]
  );
  return result.insertId;
};

const getAnnouncementsForLecturer = async (lecturerId, limit = 5) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 20));
  const [rows] = await pool.query(
    `SELECT a.id, a.course_id, c.course_name, a.title, a.message, a.created_at
     FROM course_announcements a
     JOIN courses c ON c.id = a.course_id
     WHERE a.lecturer_id = ?
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [lecturerId, safeLimit]
  );
  return rows;
};

module.exports = {
  ensureAnnouncementsTable,
  createAnnouncement,
  getAnnouncementsForLecturer,
};
