const userModel = require("../models/userModel");
const courseModel = require("../models/courseModel");
const transactionModel = require("../models/transactionModel");
const courseCategoryModel = require("../models/courseCategoryModel");

const getDashboard = async (req, res, next) => {
  try {
    const role = req.query.role ? String(req.query.role).toLowerCase() : null;
    const roleFilter = ["student", "lecturer", "admin"].includes(role) ? role : null;

    const users = await userModel.listUsers(roleFilter);
    const categories = await courseCategoryModel.listCategories();
    const totalCourses = await courseModel.countCourses();
    const totalEnrollments = await courseModel.countEnrollments();
    const totalTransactions = await transactionModel.countTransactions();

    return res.status(200).json({
      users,
      categories,
      totals: {
        courses: totalCourses,
        enrollments: totalEnrollments,
        transactions: totalTransactions,
      },
      filter: { role: roleFilter },
    });
  } catch (err) {
    next(err);
  }
};

const createCategory = async (req, res, next) => {
  try {
    const { category_name, description } = req.body;
    if (!category_name) {
      return res.status(400).json({ error: "category_name is required." });
    }
    const category_id = await courseCategoryModel.createCategory({
      category_name,
      description,
    });
    return res.status(201).json({ message: "Category created.", category_id });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDashboard,
  createCategory,
};
