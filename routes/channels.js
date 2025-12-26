const express = require('express');
const router = express.Router();
const WebConnection = require('../models/WebConnection');
const authMiddleware = require('../middleware/auth');
const processor = require('../services/webhookProcessor');
router.use(authMiddleware);

// 1. لیست کانال‌های وب کاربر
router.get('/web', async (req, res) => {
  try {
    const channels = await WebConnection.find({ user_id: req.user.id });
    res.json(channels);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. اتصال سایت جدید
router.post('/web', async (req, res) => {
  try {
    const { name, siteUrl, consumerKey, consumerSecret, widgetConfig } =
      req.body;

    const newChannel = await WebConnection.create({
      user_id: req.user.id,
      name,
      siteUrl,
      consumerKey,
      consumerSecret,
      widgetConfig,
    });

    res.json(newChannel);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. دریافت پیام از ویجت وب
router.post('/web/message', async (req, res) => {
  try {
    const { channelId, guestId, message } = req.body;

    const simulatedEntry = {
      id: channelId,
      platform: 'web', // این پرچم مهم است
    };

    const simulatedMessaging = {
      sender: { id: guestId },
      message: { text: message },
    };

    // ارسال به پردازشگر (بدون await)
    processor.handleMessage(simulatedEntry, simulatedMessaging);

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
