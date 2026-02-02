const authService = require("../services/authService");

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  const token = bearerToken || (req.cookies ? req.cookies.token : null);

  if (!token) {
    return res.status(401).json({ error: "Authentication token is required." });
  }

  try {
    req.user = authService.verifyAuthToken(token);
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
};

module.exports = {
  authenticateToken,
};
