const pool = require("./db");

const parseNumber = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const parseBooleanFlag = (value, fallback = 1) => {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).toLowerCase();
  if (["1", "true", "on"].includes(normalized)) return 1;
  if (["0", "false", "off"].includes(normalized)) return 0;
  return fallback;
};

const ensureSubscriptionModelColumn = async () => {
  const [rows] = await pool.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'courses'
       AND COLUMN_NAME = 'subscription_model'
     LIMIT 1`
  );
  if (rows.length) return;
  await pool.query(
    "ALTER TABLE courses ADD COLUMN subscription_model ENUM('free','pro') NOT NULL DEFAULT 'free' AFTER is_active"
  );
};

const normalizeSubscriptionModel = (value, fallback = "free") => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "pro") return "pro";
  if (normalized === "free") return "free";
  return fallback;
};

const getCoursesWithStats = async (filters = {}) => {
  const where = [];
  const params = [];

  if (filters.q) {
    where.push(
      "(c.course_name LIKE ? OR c.description LIKE ? OR c.category LIKE ? OR c.level LIKE ? OR c.language LIKE ?)"
    );
    const term = `%${filters.q}%`;
    params.push(term, term, term, term, term);
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

  const includeInactive = ["1", "true", "on"].includes(String(filters.includeInactive || "").toLowerCase());
  if (!includeInactive) {
    where.push("(c.is_active = 1 OR c.is_active IS NULL)");
  }
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

const getCourseFilterOptions = async (options = {}) => {
  const includeInactive = ["1", "true", "on"].includes(String(options.includeInactive || "").toLowerCase());
  const activeOnlyWhere = includeInactive ? "" : "WHERE is_active = 1 OR is_active IS NULL";
  const [rows] = await pool.query(
    `SELECT DISTINCT
       NULLIF(TRIM(category), '') AS category,
       NULLIF(TRIM(level), '') AS level,
       NULLIF(TRIM(language), '') AS language
     FROM courses
     ${activeOnlyWhere}`
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
            c.language, c.stock_qty, c.is_active, c.subscription_model,
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
    subscription_model,
  } = course;
  await pool.query(
    `INSERT INTO courses
      (course_name, description, price, category, level, language, stock_qty, instructor_id, subscription_model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      course_name,
      description || null,
      price,
      category || null,
      level || null,
      language || null,
      Number.isFinite(Number(stock_qty)) ? Number(stock_qty) : 0,
      instructor_id || null,
      normalizeSubscriptionModel(subscription_model),
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
    is_active,
    subscription_model,
  } = course;
  const normalizedIsActive = parseBooleanFlag(is_active, 1);
  await pool.query(
    `UPDATE courses
     SET course_name = ?, price = ?, category = ?, description = ?,
         level = ?, language = ?, stock_qty = ?, instructor_id = ?, is_active = ?, subscription_model = ?
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
      normalizedIsActive,
      normalizeSubscriptionModel(subscription_model),
      id,
    ]
  );
};

const deleteCourse = async (id) => {
  await pool.query("DELETE FROM courses WHERE id = ?", [id]);
};

const getCoursesByInstructor = async (lecturerId) => {
  const [rows] = await pool.query(
    `SELECT id, course_name, category, price, level, language, is_active, subscription_model
     FROM courses
     WHERE instructor_id = ?
     ORDER BY course_name`,
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

const getInstructorCourseSummaries = async (lecturerId) => {
  const [rows] = await pool.query(
    `SELECT
       c.id,
       c.course_name,
       c.category,
       c.price,
       c.level,
       c.language,
       c.is_active,
       c.subscription_model,
       c.description,
       c.stock_qty,
       COALESCE(m.enrollment_count, 0) AS enrollment_count,
       COALESCE(m.avg_progress, 0) AS avg_progress,
       COALESCE(r.avg_rating, 0) AS avg_rating,
       COALESCE(o.revenue, 0) AS revenue
     FROM courses c
     LEFT JOIN (
       SELECT course_id, COUNT(*) AS enrollment_count, AVG(progress) AS avg_progress
       FROM enrollments
       GROUP BY course_id
     ) m ON m.course_id = c.id
     LEFT JOIN (
       SELECT course_id, AVG(rating) AS avg_rating
       FROM course_reviews
       GROUP BY course_id
     ) r ON r.course_id = c.id
     LEFT JOIN (
       SELECT course_id, SUM(unit_price * quantity) AS revenue
       FROM order_items
       GROUP BY course_id
     ) o ON o.course_id = c.id
     WHERE c.instructor_id = ?
     ORDER BY c.course_name ASC`,
    [lecturerId]
  );
  return rows.map((row) => ({
    ...row,
    enrollment_count: Number(row.enrollment_count || 0),
    avg_progress: Number(row.avg_progress || 0),
    avg_rating: Number(row.avg_rating || 0),
    revenue: Number(row.revenue || 0),
    stock_qty: Number(row.stock_qty || 0),
    description: row.description || "",
  }));
};

module.exports = {
  ensureSubscriptionModelColumn,
  getCoursesWithStats,
  getCourseFilterOptions,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  getCoursesByInstructor,
  getCoursesForInstructors,
  getInstructorStats,
  getInstructorCourseSummaries,
};
