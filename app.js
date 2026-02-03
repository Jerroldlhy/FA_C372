const path = require("path");
const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const jwtSecret = process.env.JWT_SECRET || "dev_secret_change_me";
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT) || 587;
const smtpSecure = (process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM || smtpUser;
const appUrl = process.env.APP_URL || "http://localhost:3000";

const transporter =
  smtpHost && smtpUser && smtpPass
    ? nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      })
    : null;

const sendVerificationEmail = async (email, token, name) => {
  if (!transporter) {
    console.warn("SMTP transporter not configured; skipping verification email.");
    return;
  }
  const verificationUrl = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  try {
    await transporter.sendMail({
      from: smtpFrom,
      to: email,
      subject: "Verify your EduSphere account",
      html: `
        <p>Hi ${name || "Learner"},</p>
        <p>Thanks for signing up. Confirm your email to unlock the student dashboard.</p>
        <p><a href="${verificationUrl}">Verify your email</a></p>
        <p>If you did not sign up for EduSphere, just ignore this message.</p>
      `,
    });
  } catch (mailErr) {
    console.error("Failed to send verification email:", mailErr);
  }
};

const attachCurrentUser = (req, res, next) => {
  res.locals.currentUser = null;
  const token = req.cookies ? req.cookies.token : null;
  if (!token) {
    return next();
  }
  try {
    const payload = jwt.verify(token, jwtSecret);
    req.user = payload;
    res.locals.currentUser = payload;
  } catch (err) {
    // Invalid token, ignore and proceed without a user
  }
  next();
};

app.use(attachCurrentUser);

const authenticateToken = (req, res, next) => {
  if (req.user) {
    return next();
  }
  const token = req.cookies ? req.cookies.token : null;
  if (!token) {
    return res.redirect("/login");
  }
  try {
    const payload = jwt.verify(token, jwtSecret);
    req.user = payload;
    res.locals.currentUser = payload;
    next();
  } catch (err) {
    return res.redirect("/login");
  }
};

const requireRole = (allowedRoles) => (req, res, next) => {
  const role = req.user?.role ? String(req.user.role).toLowerCase() : null;
  if (!role || !allowedRoles.map((r) => r.toLowerCase()).includes(role)) {
    return res.status(403).send("Forbidden");
  }
  next();
};

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

app.get("/courses", async (req, res, next) => {
  try {
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
       ORDER BY c.course_name ASC`
    );

    const courseIds = courses.map((course) => course.id);
    const reviewsMap = {};
    if (courseIds.length) {
      const [reviewRows] = await pool.query(
        `SELECT r.*, u.name AS student_name
         FROM course_reviews r
         JOIN users u ON r.student_id = u.id
         WHERE r.course_id IN (?)
         ORDER BY r.created_at DESC`,
        [courseIds]
      );
      reviewRows.forEach((review) => {
        if (!reviewsMap[review.course_id]) {
          reviewsMap[review.course_id] = [];
        }
        reviewsMap[review.course_id].push(review);
      });
    }

    const [lecturers] = await pool.query(
      "SELECT id, name FROM users WHERE role = 'lecturer' ORDER BY name"
    );

    let enrolledCourseIds = [];
    let walletBalance = 0;
    if (req.user && String(req.user.role).toLowerCase() === "student") {
      const [enrollRows] = await pool.query(
        "SELECT course_id FROM enrollments WHERE student_id = ?",
        [req.user.id]
      );
      enrolledCourseIds = enrollRows.map((row) => row.course_id);
      const [walletRows] = await pool.query(
        "SELECT balance FROM wallet WHERE user_id = ? LIMIT 1",
        [req.user.id]
      );
      walletBalance = walletRows.length ? Number(walletRows[0].balance) : 0;
    }

    res.render("courses", {
      courses,
      reviewsMap,
      enrolledCourseIds,
      walletBalance,
      lecturers,
      status: req.query,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/mentors", async (req, res, next) => {
  try {
    const roleFilter = "lecturer";
    const [lecturers] = await pool.query(
      "SELECT id, name, email, created_at FROM users WHERE role = ? ORDER BY name ASC",
      [roleFilter]
    );

    const instructorIds = lecturers.map((lect) => lect.id);
    let coursesByInstructor = {};
    let statsByInstructor = {};
    if (instructorIds.length) {
      const [courseRows] = await pool.query(
        `SELECT c.instructor_id, c.id, c.course_name, c.category, c.price
         FROM courses c
         WHERE c.instructor_id IN (?)
         ORDER BY c.created_at DESC`,
        [instructorIds]
      );
      courseRows.forEach((course) => {
        if (!coursesByInstructor[course.instructor_id]) {
          coursesByInstructor[course.instructor_id] = [];
        }
        coursesByInstructor[course.instructor_id].push(course);
      });

      const [ratingRows] = await pool.query(
        `SELECT c.instructor_id, AVG(r.rating) AS avg_rating, COUNT(r.id) AS review_count
         FROM courses c
         LEFT JOIN course_reviews r ON c.id = r.course_id
         WHERE c.instructor_id IN (?)
         GROUP BY c.instructor_id`,
        [instructorIds]
      );
      ratingRows.forEach((row) => {
        statsByInstructor[row.instructor_id] = {
          avg_rating: Number(row.avg_rating || 0).toFixed(1),
          review_count: row.review_count || 0,
        };
      });
    }

    res.render("mentors", {
      lecturers,
      coursesByInstructor,
      statsByInstructor,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/plans", (req, res) => {
  const plans = [
    { name: "Starter", price: 0, description: "Access free lessons and community forums.", perks: ["Free mini-courses", "Community support", "Limited certificates"] },
    { name: "Pro", price: 29, description: "Unlimited learning, projects, and certificates.", perks: ["Unlimited course access", "Downloadable materials", "Project reviews", "Priority support"] },
    { name: "Enterprise", price: "Custom", description: "Team analytics and dedicated success manager.", perks: ["Dedicated account manager", "Custom learning paths", "API access", "Advanced analytics"] },
  ];
  res.render("plans", { plans });
});

app.post(
  "/courses",
  authenticateToken,
  requireRole(["lecturer", "admin"]),
  async (req, res, next) => {
    try {
      const { course_name, price, category, description, instructor_id } = req.body;
      if (!course_name || !price) {
        return res.redirect("/courses?course_error=missing");
      }
      const role = String(req.user.role).toLowerCase();
      let assignedInstructor = null;
      if (role === "lecturer") {
        assignedInstructor = req.user.id;
      } else if (instructor_id) {
        const [instructorRows] = await pool.query(
          "SELECT id FROM users WHERE id = ? AND role = 'lecturer' LIMIT 1",
          [instructor_id]
        );
        if (instructorRows.length) {
          assignedInstructor = instructor_id;
        }
      }
      await pool.query(
        "INSERT INTO courses (course_name, description, price, category, instructor_id) VALUES (?, ?, ?, ?, ?)",
        [course_name, description || null, price, category || null, assignedInstructor]
      );
      res.redirect("/courses?course_created=1");
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  "/courses/:id/update",
  authenticateToken,
  requireRole(["lecturer", "admin"]),
  async (req, res, next) => {
    try {
      const courseId = req.params.id;
      const [rows] = await pool.query("SELECT * FROM courses WHERE id = ? LIMIT 1", [
        courseId,
      ]);
      if (!rows.length) {
        return res.redirect("/courses?course_error=not_found");
      }
      const course = rows[0];
      const role = String(req.user.role).toLowerCase();
      if (role === "lecturer" && course.instructor_id !== req.user.id) {
        return res.status(403).send("Forbidden");
      }
      const { course_name, price, category, description } = req.body;
      let assignedInstructor = course.instructor_id;
      if (role === "admin" && req.body.instructor_id) {
        const [instructorRows] = await pool.query(
          "SELECT id FROM users WHERE id = ? AND role = 'lecturer' LIMIT 1",
          [req.body.instructor_id]
        );
        if (instructorRows.length) {
          assignedInstructor = req.body.instructor_id;
        }
      }
      await pool.query(
        "UPDATE courses SET course_name = ?, price = ?, category = ?, description = ?, instructor_id = ? WHERE id = ?",
        [
          course_name || course.course_name,
          price || course.price,
          category || null,
          description || null,
          assignedInstructor,
          courseId,
        ]
      );
      res.redirect("/courses?course_updated=1");
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  "/courses/:id/delete",
  authenticateToken,
  requireRole(["lecturer", "admin"]),
  async (req, res, next) => {
    try {
      const courseId = req.params.id;
      const [rows] = await pool.query("SELECT * FROM courses WHERE id = ? LIMIT 1", [
        courseId,
      ]);
      if (!rows.length) {
        return res.redirect("/courses?course_error=not_found");
      }
      const course = rows[0];
      const role = String(req.user.role).toLowerCase();
      if (role === "lecturer" && course.instructor_id !== req.user.id) {
        return res.status(403).send("Forbidden");
      }
      await pool.query("DELETE FROM courses WHERE id = ?", [courseId]);
      res.redirect("/courses?course_deleted=1");
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  "/courses/:id/review",
  authenticateToken,
  requireRole(["student"]),
  async (req, res, next) => {
    try {
      const courseId = req.params.id;
      const [enrolled] = await pool.query(
        "SELECT id FROM enrollments WHERE course_id = ? AND student_id = ? LIMIT 1",
        [courseId, req.user.id]
      );
      if (!enrolled.length) {
        return res.redirect("/courses?review_error=not_enrolled");
      }
      let rating = Number(req.body.rating || 0);
      if (!rating || rating < 1) rating = 1;
      if (rating > 5) rating = 5;
      const reviewText = req.body.review || null;
      await pool.query(
        `INSERT INTO course_reviews (course_id, student_id, rating, review)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE rating = VALUES(rating), review = VALUES(review), created_at = CURRENT_TIMESTAMP`,
        [courseId, req.user.id, rating, reviewText]
      );
      res.redirect("/courses?review_success=1");
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  "/courses/:id/enroll",
  authenticateToken,
  requireRole(["student"]),
  async (req, res, next) => {
    const courseId = req.params.id;
    const paymentMethod = (req.body.payment_method || "wallet").toLowerCase();
    try {
      const [courseRows] = await pool.query(
        "SELECT price FROM courses WHERE id = ? LIMIT 1",
        [courseId]
      );
      if (!courseRows.length) {
        return res.redirect("/courses?enroll_error=course_missing");
      }
      const price = Number(courseRows[0].price);
      if (price < 0) {
        return res.redirect("/courses?enroll_error=invalid_price");
      }

      const [existing] = await pool.query(
        "SELECT id FROM enrollments WHERE course_id = ? AND student_id = ? LIMIT 1",
        [courseId, req.user.id]
      );
      if (existing.length) {
        return res.redirect("/courses?enroll_error=already_enrolled");
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        if (paymentMethod === "wallet") {
          const [walletRows] = await connection.query(
            "SELECT balance FROM wallet WHERE user_id = ? LIMIT 1",
            [req.user.id]
          );
          const balance = walletRows.length ? Number(walletRows[0].balance) : 0;
          if (balance < price) {
            await connection.rollback();
            return res.redirect("/courses?enroll_error=wallet_balance");
          }
          await connection.query(
            "UPDATE wallet SET balance = balance - ? WHERE user_id = ?",
            [price, req.user.id]
          );
          await connection.query(
            "INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, 'completed')",
            [req.user.id, "wallet_payment", price]
          );
        } else {
          await connection.query(
            "INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, 'pending')",
            [req.user.id, "external_payment", price]
          );
        }

        await connection.query(
          "INSERT INTO enrollments (course_id, student_id) VALUES (?, ?)",
          [courseId, req.user.id]
        );
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
      return res.redirect("/courses?enrolled=1");
    } catch (err) {
      next(err);
    }
  }
);

app.get("/login", (req, res) => {
  res.render("login", { error: null, info: req.query });
});

app.get("/auth/google", (req, res) => {
  res.redirect("/login?social_unavailable=1");
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
      "SELECT id, name, email, password_hash, role, email_verified FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (!rows.length) {
      return res.status(401).render("login", {
        error: "Invalid email or password.",
      });
    }

    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!user.email_verified) {
      return res.status(403).render("login", {
        error: "Please verify your email before logging in.",
        info: { pending_verification: true },
      });
    }

    if (!isValid) {
      return res.status(401).render("login", {
        error: "Invalid email or password.",
        info: null,
      });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name },
      jwtSecret,
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
    const verificationToken = crypto.randomBytes(24).toString("hex");
    await pool.query(
      "INSERT INTO users (name, email, password_hash, role, verification_token) VALUES (?, ?, ?, ?, ?)",
      [name, email, passwordHash, "student", verificationToken]
    );
    await sendVerificationEmail(email, verificationToken, name);

    return res.redirect("/login?sent_verify=1");
  } catch (err) {
    next(err);
  }
});

app.post("/resend-verification", async (req, res, next) => {
  try {
    const email = (req.body.email || "").trim();
    if (!email) {
      return res.redirect("/login?resend_error=missing");
    }
    const [rows] = await pool.query(
      "SELECT id, name, email_verified FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (!rows.length) {
      return res.redirect("/login?resend_error=not_found");
    }
    const user = rows[0];
    if (user.email_verified) {
      return res.redirect("/login?resend=already_verified");
    }
    const verificationToken = crypto.randomBytes(24).toString("hex");
    await pool.query(
      "UPDATE users SET verification_token = ? WHERE id = ?",
      [verificationToken, user.id]
    );
    await sendVerificationEmail(email, verificationToken, user.name);
    res.redirect("/login?resent=1");
  } catch (err) {
    next(err);
  }
});

app.get("/verify-email", async (req, res, next) => {
  const { token } = req.query;
  if (!token) {
    return res.redirect("/login?verify_error=missing");
  }
  try {
    const [rows] = await pool.query(
      "SELECT id, email_verified FROM users WHERE verification_token = ? LIMIT 1",
      [token]
    );
    if (!rows.length) {
      return res.redirect("/login?verify_error=invalid");
    }
    const user = rows[0];
    if (user.email_verified) {
      return res.redirect("/login?verified=1");
    }
    await pool.query(
      "UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?",
      [user.id]
    );
    res.redirect("/login?verified=1");
  } catch (err) {
    next(err);
  }
});

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

app.get(
  "/dashboard/lecturer",
  authenticateToken,
  requireRole(["lecturer"]),
  async (req, res, next) => {
    try {
      const lecturerId = req.user.id;
      const [courses] = await pool.query(
        "SELECT id, course_name, category, price FROM courses WHERE instructor_id = ? ORDER BY course_name",
        [lecturerId]
      );

      const courseIds = courses.map((course) => course.id);
      const [enrollments] = await pool.query(
        `SELECT e.id, e.progress, c.course_name, u.name AS student_name
         FROM enrollments e
         JOIN courses c ON e.course_id = c.id
         JOIN users u ON e.student_id = u.id
         WHERE c.instructor_id = ?
         ORDER BY e.created_at DESC
         LIMIT 20`,
        [lecturerId]
      );

      const totalStudents = await pool.query(
        `SELECT COUNT(DISTINCT student_id) AS student_count
         FROM enrollments e
         JOIN courses c ON e.course_id = c.id
         WHERE c.instructor_id = ?`,
        [lecturerId]
      );

      res.render("lecturerDashboard", {
        courses,
        enrollments,
        studentCount: totalStudents[0][0]?.student_count || 0,
        status: req.query,
      });
    } catch (err) {
      next(err);
    }
  }
);

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
    const method = (req.body.payment_method || "wallet").toLowerCase();
    const type =
      method === "wallet" ? "wallet_topup" : `${method}_topup`.replace(/[^a-z0-9_]/g, "");
    const userId = req.user.id;
    await pool.query(
      "INSERT INTO wallet (user_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)",
      [userId, amount]
    );
    await pool.query(
      "INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, ?)",
      [userId, type, amount, "completed"]
    );
    res.redirect(`/dashboard/student?topup_success=1&method=${method}`);
  } catch (err) {
    next(err);
  }
});

app.get(
  "/wallet",
  authenticateToken,
  requireRole(["student"]),
  async (req, res, next) => {
    try {
      const userId = req.user.id;
      const [walletRows] = await pool.query(
        "SELECT balance FROM wallet WHERE user_id = ? LIMIT 1",
        [userId]
      );
      const walletBalance = walletRows.length ? Number(walletRows[0].balance) : 0;

      const [transactions] = await pool.query(
        `SELECT id, type, amount, status, created_at
         FROM transactions
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 12`,
        [userId]
      );

      res.render("wallet", {
        walletBalance,
        transactions,
        status: req.query,
      });
    } catch (err) {
      next(err);
    }
  }
);

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
