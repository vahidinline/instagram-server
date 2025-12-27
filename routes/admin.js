const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Transaction = require('../models/Transaction');
const MessageLog = require('../models/MessageLogs');
const Plan = require('../models/Plan');
const Persona = require('../models/Persona');
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

    const messageCount = await MessageLog.countDocuments();

    res.json({
      userCount,
      activeSubs: subCount,
      totalRevenue: revenueAgg[0]?.total || 0,
      totalTokens: tokenAgg[0]?.total || 0,
      messageCount,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. لیست کاربران (برای دراپ‌داون)
router.get('/users', async (req, res) => {
  try {
    const users = await User.find()
      .select('name email phone created_at')
      .sort({ created_at: -1 })
      .limit(100);
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// 🚀 بخش سرویس‌های مدیریت شده (VIP)
// ==========================================

// 3. دریافت لیست تمام پرسوناهای VIP (مخصوص ادمین)
router.get('/vip-personas', async (req, res) => {
  try {
    // تمام پرسوناهایی که قفل هستند را بگیر و نام کاربر صاحبش را هم بیاور
    const personas = await Persona.find({ isLocked: true })
      .populate('user_id', 'name email')
      .sort({ created_at: -1 });

    res.json(personas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. ساخت پرسونای VIP جدید
router.post('/create-vip-persona', async (req, res) => {
  try {
    const { targetUserId, name, systemPrompt, avatar } = req.body;

    if (!targetUserId || !name || !systemPrompt) {
      return res.status(400).json({ error: 'تمام فیلدها الزامی هستند.' });
    }

    const vipPersona = await Persona.create({
      user_id: targetUserId,
      name: name + ' (VIP) 🌟',
      gender: 'robot',
      avatar: avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=VIP',
      config: {
        tone: 80,
        emojiUsage: true,
        responseLength: 'medium',
        role: 'sales',
        salesStrategy: { aggressiveness: 'active', collectLead: true },
      },
      systemPrompt: systemPrompt,
      isSystem: false,
      isLocked: true, // قفل شده
    });

    res.json({ success: true, persona: vipPersona });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. ویرایش پرسونای VIP
router.put('/vip-personas/:id', async (req, res) => {
  try {
    const { name, systemPrompt, targetUserId } = req.body;

    const updated = await Persona.findByIdAndUpdate(
      req.params.id,
      {
        name,
        systemPrompt,
        user_id: targetUserId, // امکان تغییر صاحب پرسونا
      },
      { new: true }
    );

    if (!updated) return res.status(404).json({ error: 'یافت نشد' });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 6. حذف پرسونای VIP
router.delete('/vip-personas/:id', async (req, res) => {
  try {
    await Persona.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
