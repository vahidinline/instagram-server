const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Transaction = require('../models/Transaction');
const MessageLog = require('../models/MessageLogs');
const Plan = require('../models/Plan');
const authMiddleware = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');

// امنیت: فقط ادمین کل
router.use(authMiddleware, adminMiddleware);

// 1. آمار داشبورد
router.get('/stats', async (req, res) => {
  try {
    const userCount = await User.countDocuments();
    const subCount = await Subscription.countDocuments({ status: 'active' });

    const revenueAgg = await Transaction.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const tokenAgg = await Subscription.aggregate([
      { $group: { _id: null, total: { $sum: '$usage.aiTokensUsed' } } },
    ]);

    res.json({
      userCount,
      activeSubs: subCount,
      totalRevenue: revenueAgg[0]?.total || 0,
      totalTokens: tokenAgg[0]?.total || 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. لیست کاربران (با جزئیات اشتراک)
router.get('/users', async (req, res) => {
  try {
    const users = await User.find()
      .select('-password -otp')
      .sort({ created_at: -1 })
      .limit(100);

    const usersWithSub = await Promise.all(
      users.map(async (u) => {
        const sub = await Subscription.findOne({
          user_id: u._id,
          status: 'active',
        }).populate('plan_id');
        return {
          ...u._doc,
          planName: sub?.plan_id?.name || 'Free/Expired',
          usage: sub?.usage || { messagesUsed: 0, aiTokensUsed: 0 },
          limits: sub?.currentLimits || {},
        };
      })
    );

    res.json(usersWithSub);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. لیست تراکنش‌ها (مالی)
router.get('/transactions', async (req, res) => {
  try {
    const txs = await Transaction.find()
      .populate('user_id', 'name phone') // نام خریدار
      .populate('plan_id', 'name') // نام محصول
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(txs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. ارتقای دستی کاربر (Gift Pro Plan)
router.put('/users/:id/upgrade', async (req, res) => {
  try {
    const userId = req.params.id;

    // پیدا کردن پلن پرو
    const proPlan = await Plan.findOne({ slug: 'pro_monthly' });
    if (!proPlan) return res.status(404).json({ error: 'Pro Plan not found' });

    // حذف اشتراک قبلی
    await Subscription.deleteMany({ user_id: userId });

    // ایجاد اشتراک ۳۰ روزه
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    await Subscription.create({
      user_id: userId,
      plan_id: proPlan._id,
      currentLimits: proPlan.limits,
      currentFeatures: proPlan.features,
      endDate: endDate,
      status: 'active',
    });

    res.json({ success: true, message: 'User upgraded to PRO manually.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
