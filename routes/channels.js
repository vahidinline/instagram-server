const express = require('express');
const router = express.Router();
const WebConnection = require('../models/WebConnection');
const authMiddleware = require('../middleware/auth');
const processor = require('../services/webhookProcessor');

// ==========================================
// 🔓 روت‌های عمومی (Public) - بدون نیاز به توکن
// ==========================================

// 1. دریافت کانفیگ ویجت (رنگ، لوگو و...)
router.get('/config/:id', async (req, res) => {
  try {
    const channel = await WebConnection.findById(req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    res.json({
      name: channel.name,
      welcomeMessage: channel.widgetConfig?.welcomeMessage,
      color: channel.widgetConfig?.color,
      logoUrl: channel.widgetConfig?.logoUrl,
      position: channel.widgetConfig?.position,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. دریافت پیام از ویجت
router.post('/web/message', async (req, res) => {
  try {
    const { channelId, guestId, message } = req.body;

    console.log(`🌐 Web Widget Message: ${message} (User: ${guestId})`);

    const simulatedEntry = {
      id: channelId,
      platform: 'web',
      time: Date.now(),
    };

    const simulatedMessaging = {
      sender: { id: guestId },
      message: { text: message, is_echo: false },
    };

    // مستقیماً به پردازشگر می‌فرستیم (بدون صف Redis برای سرعت بیشتر در وب)
    processor.handleMessage(simulatedEntry, simulatedMessaging);

    res.json({ success: true });
  } catch (e) {
    console.error('Web Message Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// 🔒 روت‌های خصوصی (Private) - فقط برای ادمین
// ==========================================

// 3. لیست کانال‌های کاربر
router.get('/web', authMiddleware, async (req, res) => {
  try {
    const channels = await WebConnection.find({ user_id: req.user.id });
    res.json(channels);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. ساخت کانال جدید
router.post('/web', authMiddleware, async (req, res) => {
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

module.exports = router;
