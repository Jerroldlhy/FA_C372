const express = require("express");
const paymentController = require("../controllers/paymentController");
const { authenticateToken } = require("../middleware/authMiddleware");
const { requireStudent } = require("../middleware/roleMiddleware");

const router = express.Router();
const studentPaymentRouter = express.Router();

studentPaymentRouter.post(
  "/courses/:id/pay",
  authenticateToken,
  requireStudent,
  paymentController.payForCourse
);

studentPaymentRouter.post(
  "/payment",
  authenticateToken,
  requireStudent,
  paymentController.makePayment
);

studentPaymentRouter.get(
  "/transactions/me",
  authenticateToken,
  requireStudent,
  paymentController.listMyTransactions
);

studentPaymentRouter.get(
  "/transactions",
  authenticateToken,
  requireStudent,
  paymentController.listMyTransactions
);

router.use("/", studentPaymentRouter);

module.exports = router;
