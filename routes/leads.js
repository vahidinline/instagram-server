const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const MessageLog = require('../models/MessageLogs');
const authMiddleware = require('../middleware/auth');

// 1. دریافت آمار KPI
router.get('/kpi', async (req, res) => {
  try {
    const { ig_accountId } = req.query;

    // کل مکالمات (تعداد افراد منحصر به فردی که پیام داده‌اند)
    // از MessageLog استفاده می‌کنیم (گروه‌بندی بر اساس sender_id)
    const uniqueConversations = await MessageLog.distinct('sender_id', {
      ig_accountId,
    });
    const totalConversations = uniqueConversations.length;

    // کل لیدهای جذب شده
    const totalLeads = await Lead.countDocuments({ ig_accountId });

    // محاسبه نرخ تبدیل (Conversion Rate)
    const conversionRate =
      totalConversations > 0
        ? ((totalLeads / totalConversations) * 100).toFixed(1)
        : 0;

    res.json({
      totalConversations,
      totalLeads,
      conversionRate,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. دریافت لیست لیدها (جدول)
router.get('/', async (req, res) => {
  try {
    const { ig_accountId } = req.query;
    const leads = await Lead.find({ ig_accountId }).sort({ created_at: -1 });
    res.json(leads);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
