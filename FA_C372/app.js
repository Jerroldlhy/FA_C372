const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const authService = require("./services/authService");

const routes = require("./routes");
const courseController = require("./controllers/courseController");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  res.locals.messages = [];
  res.locals.errors = [];
  res.locals.formData = null;
  res.locals.user = null;
  const token = req.cookies ? req.cookies.token : null;
  if (token) {
    try {
      const payload = authService.verifyAuthToken(token);
      res.locals.user = {
        id: payload.id,
        role: payload.role,
        username: `User ${payload.id}`,
      };
    } catch (err) {
      // Ignore invalid cookies in view layer.
    }
  }
  next();
});

app.get("/", courseController.renderHome);
app.use("/", routes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("Server error");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
