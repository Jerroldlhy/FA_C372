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

const ensureRecipientCountColumn = async () => {
  try {
    await pool.query(
      "ALTER TABLE course_announcements ADD COLUMN recipient_count INT NOT NULL DEFAULT 0"
    );
  } catch (err) {
    if (err && err.code === "ER_DUP_FIELDNAME") return;
    throw err;
  }
};

const createAnnouncement = async ({ courseId, lecturerId, title, message, recipientCount = 0 }) => {
  const [result] = await pool.query(
    `INSERT INTO course_announcements (course_id, lecturer_id, title, message, recipient_count)
     VALUES (?, ?, ?, ?, ?)`,
    [courseId, lecturerId, title, message || null, Number(recipientCount || 0)]
  );
  return result.insertId;
};

const getAnnouncementsForLecturer = async (lecturerId, limit = 5, courseId = null) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 20));
  const where = ["a.lecturer_id = ?"];
  const params = [lecturerId];
  if (courseId) {
    where.push("a.course_id = ?");
    params.push(courseId);
  }
  params.push(safeLimit);
  const [rows] = await pool.query(
    `SELECT a.id, a.course_id, c.course_name, a.title, a.message, a.recipient_count, a.created_at
     FROM course_announcements a
     JOIN courses c ON c.id = a.course_id
     WHERE ${where.join(" AND ")}
     ORDER BY a.created_at DESC
     LIMIT ?`,
    params
  );
  return rows;
};

module.exports = {
  ensureAnnouncementsTable,
  ensureRecipientCountColumn,
  createAnnouncement,
  getAnnouncementsForLecturer,
};
