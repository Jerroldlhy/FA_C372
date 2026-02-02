const express = require("express");
const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const adminRoutes = require("./adminRoutes");
const courseRoutes = require("./courseRoutes");
const walletRoutes = require("./walletRoutes");
const paymentRoutes = require("./paymentRoutes");

const router = express.Router();

// Auth API routes
router.use("/", authRoutes);

// Web/admin/user routes
router.use("/", userRoutes);

// Admin routes
router.use("/", adminRoutes);

// Course routes
router.use("/courses", courseRoutes);

// Wallet routes
router.use("/", walletRoutes);

// Payment routes
router.use("/", paymentRoutes);

module.exports = router;
