const pool = require("./db");

const listCategories = async () => {
  const [rows] = await pool.query(
    "SELECT category_id, category_name, description, is_active FROM course_categories ORDER BY category_name"
  );
  return rows;
};

const createCategory = async ({ category_name, description }) => {
  const [result] = await pool.query(
    "INSERT INTO course_categories (category_name, description) VALUES (?, ?)",
    [category_name, description || null]
  );
  return result.insertId;
};

const updateCategory = async (categoryId, { category_name, description, is_active }) => {
  await pool.query(
    `UPDATE course_categories
     SET category_name = ?, description = ?, is_active = ?
     WHERE category_id = ?`,
    [category_name, description || null, is_active ? 1 : 0, categoryId]
  );
};

const deleteCategory = async (categoryId) => {
  await pool.query("DELETE FROM course_categories WHERE category_id = ?", [categoryId]);
};

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
