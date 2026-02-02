const userModel = require("../models/userModel");
const authService = require("../services/authService");

const signup = async (req, res, next) => {
  try {
    const { username, email, password, role } = req.body;
    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ error: "username, email, and password are required." });
    }

    const existing = await userModel.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const hashedPassword = await authService.hashPassword(password);
    const finalRole = authService.normalizeRole(role, "student");

    const userId = await userModel.createUser({
      username,
      email,
      password: hashedPassword,
      role: finalRole,
    });

    const token = authService.signAuthToken({
      userId,
      role: finalRole,
      expiresIn: "1h",
    });

    return res.status(201).json({
      message: "User created successfully.",
      token,
    });
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required." });
    }

    const user = await userModel.findByEmail(email);
    if (!user) {
      return res.status(400).json({ error: "Invalid email or password." });
    }

    const isValid = await authService.comparePassword(password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: "Invalid email or password." });
    }

    const token = authService.signAuthToken({
      userId: user.user_id,
      role: user.role,
      expiresIn: "1h",
    });

    res.cookie("token", token, { httpOnly: true });
    return res.status(200).json({
      message: "Login successful.",
      token,
      user: { user_id: user.user_id, role: user.role },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  signup,
  login,
};
