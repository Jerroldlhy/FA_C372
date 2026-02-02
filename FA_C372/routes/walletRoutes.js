const express = require("express");
const walletController = require("../controllers/walletController");
const { authenticateToken } = require("../middleware/authMiddleware");
const { requireStudent } = require("../middleware/roleMiddleware");

const router = express.Router();

router.get("/wallet", authenticateToken, requireStudent, walletController.getWalletSummary);
router.post(
  "/wallet/topup",
  authenticateToken,
  requireStudent,
  walletController.topUpWallet
);

module.exports = router;
