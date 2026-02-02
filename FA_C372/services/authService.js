const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const ALLOWED_ROLES = ["student", "lecturer", "admin"];

const normalizeRole = (role, fallback = "student") => {
  const value = role ? String(role).toLowerCase() : fallback;
  return ALLOWED_ROLES.includes(value) ? value : fallback;
};

const hashPassword = (plainPassword) => bcrypt.hash(plainPassword, 10);

const comparePassword = (plainPassword, hashedPassword) =>
  bcrypt.compare(plainPassword, hashedPassword);

const signAuthToken = ({ userId, role, expiresIn = "1h" }) =>
  jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET || "dev_secret_change_me",
    { expiresIn }
  );

const verifyAuthToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET || "dev_secret_change_me");

module.exports = {
  normalizeRole,
  hashPassword,
  comparePassword,
  signAuthToken,
  verifyAuthToken,
};
