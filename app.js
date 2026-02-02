const path = require("path");
const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

app.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.course_name, c.price, c.category,
              i.name AS instructor_name
       FROM courses c
       LEFT JOIN instructors i ON c.instructor_id = i.id
       ORDER BY c.course_name ASC`
    );
    res.render("index", { courses: rows });
  } catch (err) {
    next(err);
  }
});

app.get("/courses/:id", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.course_name, c.description, c.price, c.category,
              c.instructor_id, u.name AS instructor_name
       FROM courses c
       LEFT JOIN users u ON c.instructor_id = u.id
       WHERE c.id = ?`,
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).render("404");
    }
    res.render("courseDetails", { course: rows[0], status: req.query });
  } catch (err) {
    next(err);
  }
});

app.post("/courses/:id/enroll", async (req, res, next) => {
  try {
    const studentId = req.body.student_id;
    if (!studentId) {
      return res.status(400).send("Student ID is required to enroll.");
    }
    await pool.query(
      "INSERT INTO enrollments (course_id, student_id) VALUES (?, ?)",
      [req.params.id, studentId]
    );
    res.redirect(`/courses/${req.params.id}?enrolled=1`);
  } catch (err) {
    next(err);
  }
});

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.get("/signup", (req, res) => {
  res.render("signup", { error: null });
});

app.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).render("login", {
        error: "Email and password are required.",
      });
    }

    const [rows] = await pool.query(
      "SELECT id, name, email, password_hash, role FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (!rows.length) {
      return res.status(401).render("login", {
        error: "Invalid email or password.",
      });
    }

    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).render("login", {
        error: "Invalid email or password.",
      });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || "dev_secret_change_me",
      { expiresIn: "2h" }
    );

    res.cookie("token", token, { httpOnly: true });

    const role = (user.role || "").toLowerCase();
    if (role === "admin") {
      return res.redirect("/dashboard/admin");
    }
    if (role === "lecturer") {
      return res.redirect("/dashboard/lecturer");
    }
    return res.redirect("/dashboard/student");
  } catch (err) {
    next(err);
  }
});

app.post("/signup", async (req, res, next) => {
  try {
    const { first_name, last_name, email, password } = req.body;
    if (!first_name || !last_name || !email || !password) {
      return res.status(400).render("signup", {
        error: "All fields are required.",
      });
    }

    const [existing] = await pool.query(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (existing.length) {
      return res.status(409).render("signup", {
        error: "An account with this email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const name = `${first_name} ${last_name}`.trim();
    await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
      [name, email, passwordHash, "student"]
    );

    return res.redirect("/login");
  } catch (err) {
    next(err);
  }
});

const authenticateToken = (req, res, next) => {
  const token = req.cookies ? req.cookies.token : null;
  if (!token) {
    return res.redirect("/login");
  }
  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET || "dev_secret_change_me"
    );
    req.user = payload;
    next();
  } catch (err) {
    return res.redirect("/login");
  }
};

app.get("/dashboard/student", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [enrollments] = await pool.query(
      `SELECT e.id, e.progress, c.id AS course_id, c.course_name, c.category, c.price
       FROM enrollments e
       INNER JOIN courses c ON e.course_id = c.id
       WHERE e.student_id = ?
       ORDER BY c.course_name`,
      [userId]
    );

    const [walletRows] = await pool.query(
      "SELECT balance FROM wallet WHERE user_id = ? LIMIT 1",
      [userId]
    );
    const walletBalance = walletRows.length ? walletRows[0].balance : 0;

    const [transactions] = await pool.query(
      `SELECT id, type, amount, status, created_at
       FROM transactions
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    res.render("dashboard", {
      enrollments,
      walletBalance,
      transactions,
      status: req.query,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/dashboard/lecturer", (req, res) => {
  res.render("dashboard");
});

const requireAdmin = (req, res, next) => {
  if (!req.user || String(req.user.role).toLowerCase() !== "admin") {
    return res.status(403).send("Forbidden");
  }
  next();
};

app.get(
  "/dashboard/admin",
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      const [users] = await pool.query(
        "SELECT id, name, email, role FROM users ORDER BY role, name"
      );
      const [courses] = await pool.query(
        "SELECT id, course_name, category, price FROM courses ORDER BY course_name"
      );
      const [transactions] = await pool.query(
        "SELECT id, user_id, type, amount, status, created_at FROM transactions ORDER BY created_at DESC"
      );
      res.render("adminDashboard", {
        users,
        courses,
        transactions,
        status: req.query,
      });
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  "/admin/courses",
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { course_name, category, price, description, instructor_id } =
        req.body;
      if (!course_name || !price) {
        return res.redirect("/dashboard/admin?course_error=1");
      }
      await pool.query(
        "INSERT INTO courses (course_name, category, price, description, instructor_id) VALUES (?, ?, ?, ?, ?)",
        [course_name, category || null, price, description || null, instructor_id || null]
      );
      res.redirect("/dashboard/admin?course_created=1");
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  "/admin/courses/:id/update",
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { course_name, category, price, description, instructor_id } =
        req.body;
      await pool.query(
        "UPDATE courses SET course_name = ?, category = ?, price = ?, description = ?, instructor_id = ? WHERE id = ?",
        [
          course_name,
          category || null,
          price,
          description || null,
          instructor_id || null,
          req.params.id,
        ]
      );
      res.redirect("/dashboard/admin?course_updated=1");
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  "/admin/courses/:id/delete",
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      await pool.query("DELETE FROM courses WHERE id = ?", [req.params.id]);
      res.redirect("/dashboard/admin?course_deleted=1");
    } catch (err) {
      next(err);
    }
  }
);

app.post("/wallet/topup", authenticateToken, async (req, res, next) => {
  try {
    const amount = Number(req.body.amount || 0);
    if (!amount || amount <= 0) {
      return res.redirect("/dashboard/student?topup_error=1");
    }
    const userId = req.user.id;
    await pool.query(
      "INSERT INTO wallet (user_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)",
      [userId, amount]
    );
    await pool.query(
      "INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, ?)",
      [userId, "wallet_topup", amount, "completed"]
    );
    res.redirect("/dashboard/student?topup_success=1");
  } catch (err) {
    next(err);
  }
});

app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

app.post("/courses/:id/pay", async (req, res, next) => {
  try {
    const paymentMethod = req.body.payment_method || "paypal";
    res.redirect(
      `/courses/${req.params.id}?paid=1&method=${encodeURIComponent(
        paymentMethod
      )}`
    );
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("Server error");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
