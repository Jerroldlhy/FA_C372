const express = require("express");
const paymentController = require("../controllers/paymentController");
const { authenticateToken } = require("../middleware/authMiddleware");
const { requireStudent } = require("../middleware/roleMiddleware");

const router = express.Router();
const studentPaymentRouter = express.Router();

studentPaymentRouter.post(
  "/api/paypal/create-order",
  authenticateToken,
  requireStudent,
  paymentController.createPaypalOrder
);

studentPaymentRouter.post(
  "/api/paypal/capture-order",
  authenticateToken,
  requireStudent,
  paymentController.capturePaypalOrder
);

studentPaymentRouter.post(
  "/api/stripe/create-checkout-session",
  authenticateToken,
  requireStudent,
  paymentController.createStripeSession
);

studentPaymentRouter.get(
  "/payments/stripe/success",
  authenticateToken,
  requireStudent,
  paymentController.stripeSuccess
);

studentPaymentRouter.get(
  "/payments/stripe/cancel",
  authenticateToken,
  requireStudent,
  paymentController.stripeCancel
);

studentPaymentRouter.post(
  "/payments/nets/request",
  authenticateToken,
  requireStudent,
  paymentController.requestNets
);

studentPaymentRouter.get(
  "/payments/nets/status/:txnRetrievalRef",
  authenticateToken,
  requireStudent,
  paymentController.netsStatus
);

studentPaymentRouter.get(
  "/payments/nets/success",
  authenticateToken,
  requireStudent,
  paymentController.netsSuccess
);

studentPaymentRouter.get(
  "/payments/nets/fail",
  authenticateToken,
  requireStudent,
  paymentController.netsFail
);

studentPaymentRouter.post(
  "/api/payments/mark-failed",
  authenticateToken,
  requireStudent,
  paymentController.markPaymentFailed
);

studentPaymentRouter.get(
  "/api/transactions/me",
  authenticateToken,
  requireStudent,
  paymentController.listMyTransactions
);

router.use("/", studentPaymentRouter);

module.exports = router;
