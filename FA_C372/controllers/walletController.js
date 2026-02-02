const walletModel = require("../models/walletModel");
const walletTransactionModel = require("../models/walletTransactionModel");

const getWalletSummary = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const balance = await walletModel.getBalanceByUserId(userId);
    const transactions = await walletTransactionModel.listWalletTransactionsByUser(
      userId
    );
    return res.status(200).json({ balance, transactions });
  } catch (err) {
    next(err);
  }
};

const topUpWallet = async (req, res, next) => {
  try {
    const amount = Number(req.body.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid top-up amount." });
    }
    const userId = req.user.id;
    await walletModel.upsertTopUp(userId, amount);
    await walletTransactionModel.createWalletTransaction({
      user_id: userId,
      amount,
      transaction_type: "top-up",
      transaction_status: "completed",
      notes: "Wallet top-up",
    });
    const balance = await walletModel.getBalanceByUserId(userId);
    return res.status(200).json({ message: "Top-up successful.", balance });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getWalletSummary,
  topUpWallet,
};
