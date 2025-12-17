const express = require('express');
const router = express.Router();
const MessageLog = require('../models/MessageLogs');
const IGConnections = require('../models/IG-Connections'); // برای گرفتن عکس پروفایل یوزر (اگر ذخیره کرده باشیم)

// 1. دریافت لیست کسانی که پیام داده‌اند (Conversations List)
router.get('/conversations', async (req, res) => {
  try {
    const { ig_accountId } = req.query;
    if (!ig_accountId)
      return res.status(400).json({ error: 'Missing ig_accountId' });

    // استفاده از Aggregation برای گرفتن آخرین پیام هر کاربر
    const conversations = await MessageLog.aggregate([
      { $match: { ig_accountId: ig_accountId } },
      { $sort: { created_at: -1 } }, // جدیدترین‌ها اول
      {
        $group: {
          _id: '$sender_id',
          lastMessage: { $first: '$content' },
          timestamp: { $first: '$created_at' },
          count: { $sum: 1 },
        },
      },
      { $sort: { timestamp: -1 } }, // مرتب‌سازی نهایی بر اساس زمان آخرین پیام
    ]);

    // نکته: اینجا ما فقط sender_id داریم.
    // برای اسم و عکس، باید یک سرویس جداگانه داشته باشیم یا از کش استفاده کنیم
    // فعلا ID را برمی‌گردانیم
    res.json(conversations);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. دریافت تاریخچه پیام‌های یک کاربر خاص
router.get('/messages/:senderId', async (req, res) => {
  try {
    const { ig_accountId } = req.query;
    const { senderId } = req.params;

    const messages = await MessageLog.find({
      ig_accountId,
      sender_id: senderId,
    }).sort({ created_at: 1 }); // از قدیم به جدید

    res.json(messages);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
