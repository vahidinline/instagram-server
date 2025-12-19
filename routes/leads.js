const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const MessageLog = require('../models/MessageLogs');
const authMiddleware = require('../middleware/auth'); // امنیت

// 1. دریافت لیست لیدها (برای جدول)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { ig_accountId } = req.query;
    if (!ig_accountId)
      return res.status(400).json({ error: 'Missing Account ID' });

    const leads = await Lead.find({ ig_accountId }).sort({ created_at: -1 });
    res.json(leads);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. دریافت آمار KPI (نرخ تبدیل)
router.get('/kpi', authMiddleware, async (req, res) => {
  try {
    const { ig_accountId } = req.query;

    // تعداد کل کسانی که پیام داده‌اند (Unique Senders)
    const uniqueSenders = await MessageLog.distinct('sender_id', {
      ig_accountId,
    });
    const totalConversations = uniqueSenders.length;

    // تعداد لیدهای جذب شده
    const totalLeads = await Lead.countDocuments({ ig_accountId });

    // محاسبه درصد
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

module.exports = router;
