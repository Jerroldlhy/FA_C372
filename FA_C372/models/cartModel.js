const pool = require("../db");

const getOrCreateCartId = async (userId, connection = pool) => {
  await connection.query(
    "INSERT INTO carts (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)",
    [userId]
  );
  const [rows] = await connection.query(
    "SELECT id FROM carts WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return rows[0]?.id || null;
};

const addItemToCart = async (userId, courseId, quantity = 1) => {
  const cartId = await getOrCreateCartId(userId);
  await pool.query(
    `INSERT INTO cart_items (cart_id, course_id, quantity)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE quantity = 1`,
    [cartId, courseId, 1]
  );
};

const removeItemFromCart = async (userId, courseId) => {
  const [rows] = await pool.query(
    "SELECT id FROM carts WHERE user_id = ? LIMIT 1",
    [userId]
  );
  const cartId = rows[0]?.id;
  if (!cartId) return;
  await pool.query("DELETE FROM cart_items WHERE cart_id = ? AND course_id = ?", [
    cartId,
    courseId,
  ]);
};

const getCartItemsForUser = async (userId) => {
  const [rows] = await pool.query(
    `SELECT ci.id, ci.course_id, 1 AS quantity,
            c.course_name, c.price, c.category, c.level, c.language, c.subscription_model,
            u.name AS instructor_name
     FROM carts ca
     JOIN cart_items ci ON ca.id = ci.cart_id
     JOIN courses c ON ci.course_id = c.id
     LEFT JOIN users u ON c.instructor_id = u.id
     WHERE ca.user_id = ?
     ORDER BY ci.id DESC`,
    [userId]
  );
  return rows;
};

const clearCartByUser = async (userId, connection = pool) => {
  const [rows] = await connection.query(
    "SELECT id FROM carts WHERE user_id = ? LIMIT 1",
    [userId]
  );
  const cartId = rows[0]?.id;
  if (!cartId) return;
  await connection.query("DELETE FROM cart_items WHERE cart_id = ?", [cartId]);
};

module.exports = {
  getOrCreateCartId,
  addItemToCart,
  removeItemFromCart,
  getCartItemsForUser,
  clearCartByUser,
};
