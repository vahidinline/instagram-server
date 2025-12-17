const express = require('express');
const router = express.Router();
const Plan = require('../models/Plan');
const Transaction = require('../models/Transaction');
const Subscription = require('../models/Subscription');
const authMiddleware = require('../middleware/auth');
const zarinpal = require('../utils/zarinpal');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// دریافت اشتراک فعلی و میزان مصرف
router.get('/subscription', authMiddleware, async (req, res) => {
  try {
    // پیدا کردن اشتراک فعال
    const sub = await Subscription.findOne({
      user_id: req.user.id,
      status: 'active',
    }).populate('plan_id'); // اطلاعات پلن اصلی را هم بیار

    // اگر اشتراکی نبود (نباید پیش بیاد چون seed کردیم، ولی محض احتیاط)
    if (!sub) {
      return res.json({ hasActivePlan: false });
    }

    res.json({
      hasActivePlan: true,
      planId: sub.plan_id?._id,
      planName: sub.plan_id?.name || 'Unknown Plan',
      startDate: sub.startDate,
      endDate: sub.endDate,
      usage: sub.usage, // { messagesUsed: 5000, accountsUsed: 1 }
      limits: sub.currentLimits, // { messageCount: 5000, accountCount: 3 }
      daysLeft: Math.ceil(
        (new Date(sub.endDate) - new Date()) / (1000 * 60 * 60 * 24)
      ),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 1. لیست پلن‌ها (Public)
router.get('/plans', async (req, res) => {
  const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1 });
  res.json(plans);
});

// 2. درخواست خرید (Start Payment)
router.post('/purchase', authMiddleware, async (req, res) => {
  try {
    const { planId } = req.body;
    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    // محاسبه مبلغ (اینجا تومان است)
    const amount = plan.price;
    const callbackUrl = `${
      process.env.BACKEND_URL || 'http://localhost:3004'
    }/api/payment/callback`;
    const description = `خرید اشتراک ${plan.name} - ${req.user.phone}`;

    // درخواست به زرین‌پال
    const result = await zarinpal.requestPayment(
      amount,
      callbackUrl,
      description,
      '',
      req.user.phone
    );

    if (!result.success) {
      return res.status(500).json({ error: 'خطا در ارتباط با درگاه' });
    }

    // ایجاد رکورد تراکنش (Pending)
    await Transaction.create({
      user_id: req.user.id,
      plan_id: planId,
      amount: amount,
      authority: result.authority,
      status: 'pending',
    });

    res.json({ url: result.paymentUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. کال‌بک از بانک (Verify)
router.get('/callback', async (req, res) => {
  const { Authority, Status } = req.query;

  if (Status !== 'OK') {
    return res.redirect(`${FRONTEND_URL}/payment/failed`);
  }

  try {
    const transaction = await Transaction.findOne({ authority: Authority });
    if (!transaction)
      return res.redirect(`${FRONTEND_URL}/payment/failed?msg=NotFound`);

    // تایید نهایی با زرین‌پال
    const verify = await zarinpal.verifyPayment(transaction.amount, Authority);

    if (verify.success) {
      // الف: آپدیت تراکنش
      transaction.status = 'success';
      transaction.refId = verify.refId;
      await transaction.save();

      // ب: فعال‌سازی اشتراک برای کاربر
      const plan = await Plan.findById(transaction.plan_id);
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + plan.durationDays);

      // حذف اشتراک قبلی (یا آرشیو کردن)
      await Subscription.deleteMany({ user_id: transaction.user_id });

      // ساخت اشتراک جدید (با Snapshot از لیمیت‌ها)
      await Subscription.create({
        user_id: transaction.user_id,
        plan_id: plan._id,
        currentLimits: plan.limits, // <--- کپی کردن لیمیت‌ها
        currentFeatures: plan.features,
        endDate: endDate,
        status: 'active',
      });

      return res.redirect(
        `${FRONTEND_URL}/payment/success?refId=${verify.refId}`
      );
    } else {
      transaction.status = 'failed';
      await transaction.save();
      return res.redirect(`${FRONTEND_URL}/payment/failed`);
    }
  } catch (e) {
    console.error(e);
    return res.redirect(`${FRONTEND_URL}/payment/failed`);
  }
});

module.exports = router;
