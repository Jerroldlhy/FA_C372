const pool = require("./db");

const parseNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const getCoursesWithStats = async (filters = {}) => {
  const where = [];
  const params = [];

  if (filters.q) {
    where.push("(c.course_name LIKE ? OR c.description LIKE ?)");
    const term = `%${filters.q}%`;
    params.push(term, term);
  }

  if (filters.category) {
    where.push("c.category = ?");
    params.push(filters.category);
  }

  if (filters.level) {
    where.push("c.level = ?");
    params.push(filters.level);
  }

  if (filters.language) {
    where.push("c.language = ?");
    params.push(filters.language);
  }

  const minPrice = parseNumber(filters.minPrice);
  if (minPrice !== null) {
    where.push("c.price >= ?");
    params.push(minPrice);
  }

  const maxPrice = parseNumber(filters.maxPrice);
  if (maxPrice !== null) {
    where.push("c.price <= ?");
    params.push(maxPrice);
  }

  where.push("(c.is_active = 1 OR c.is_active IS NULL)");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [courses] = await pool.query(
    `SELECT c.*, u.name AS instructor_name,
            COALESCE(stats.avg_rating, 0) AS avg_rating,
            COALESCE(stats.review_count, 0) AS review_count
     FROM courses c
     LEFT JOIN users u ON c.instructor_id = u.id
     LEFT JOIN (
       SELECT course_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
       FROM course_reviews
       GROUP BY course_id
     ) stats ON stats.course_id = c.id
     ${whereSql}
     ORDER BY c.course_name ASC`
    ,
    params
  );
  return courses;
};

const getCourseFilterOptions = async () => {
  const [rows] = await pool.query(
    `SELECT DISTINCT
       NULLIF(TRIM(category), '') AS category,
       NULLIF(TRIM(level), '') AS level,
       NULLIF(TRIM(language), '') AS language
     FROM courses
     WHERE is_active = 1 OR is_active IS NULL`
  );

  const categories = new Set();
  const levels = new Set();
  const languages = new Set();

  rows.forEach((row) => {
    if (row.category) categories.add(row.category);
    if (row.level) levels.add(row.level);
    if (row.language) languages.add(row.language);
  });

  return {
    categories: [...categories].sort(),
    levels: [...levels].sort(),
    languages: [...languages].sort(),
  };
};

const getCourseById = async (id) => {
  const [rows] = await pool.query(
    `SELECT c.id, c.course_name, c.description, c.price, c.category, c.level,
            c.language, c.stock_qty, c.is_active,
            c.instructor_id, u.name AS instructor_name
     FROM courses c
     LEFT JOIN users u ON c.instructor_id = u.id
     WHERE c.id = ?`,
    [id]
  );
  return rows[0] || null;
};

const createCourse = async (course) => {
  const {
    course_name,
    description,
    price,
    category,
    level,
    language,
    stock_qty,
    instructor_id,
  } = course;
  await pool.query(
    `INSERT INTO courses
      (course_name, description, price, category, level, language, stock_qty, instructor_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      course_name,
      description || null,
      price,
      category || null,
      level || null,
      language || null,
      Number.isFinite(Number(stock_qty)) ? Number(stock_qty) : 0,
      instructor_id || null,
    ]
  );
};

const updateCourse = async (id, course) => {
  const {
    course_name,
    price,
    category,
    description,
    level,
    language,
    stock_qty,
    instructor_id,
  } = course;
  await pool.query(
    `UPDATE courses
     SET course_name = ?, price = ?, category = ?, description = ?,
         level = ?, language = ?, stock_qty = ?, instructor_id = ?
     WHERE id = ?`,
    [
      course_name,
      price,
      category || null,
      description || null,
      level || null,
      language || null,
      Number.isFinite(Number(stock_qty)) ? Number(stock_qty) : 0,
      instructor_id || null,
      id,
    ]
  );
};

const deleteCourse = async (id) => {
  await pool.query("DELETE FROM courses WHERE id = ?", [id]);
};

const getCoursesByInstructor = async (lecturerId) => {
  const [rows] = await pool.query(
    "SELECT id, course_name, category, price FROM courses WHERE instructor_id = ? ORDER BY course_name",
    [lecturerId]
  );
  return rows;
};

const getCoursesForInstructors = async (instructorIds) => {
  if (!instructorIds.length) return [];
  const [rows] = await pool.query(
    `SELECT c.instructor_id, c.id, c.course_name, c.category, c.price
     FROM courses c
     WHERE c.instructor_id IN (?)
     ORDER BY c.created_at DESC`,
    [instructorIds]
  );
  return rows;
};

const getInstructorStats = async (instructorIds) => {
  if (!instructorIds.length) return [];
  const [rows] = await pool.query(
    `SELECT c.instructor_id, AVG(r.rating) AS avg_rating, COUNT(r.id) AS review_count
     FROM courses c
     LEFT JOIN course_reviews r ON c.id = r.course_id
     WHERE c.instructor_id IN (?)
     GROUP BY c.instructor_id`,
    [instructorIds]
  );
  return rows;
};

module.exports = {
  getCoursesWithStats,
  getCourseFilterOptions,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  getCoursesByInstructor,
  getCoursesForInstructors,
  getInstructorStats,
};
