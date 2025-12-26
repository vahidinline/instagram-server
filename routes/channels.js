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

    // ساخت فرمت استاندارد ایونت (شبیه اینستاگرام)
    // تا webhookProcessor بتواند آن را پردازش کند
    const webEvent = {
      id: channelId, // آی‌دی کانال وب (جایگزین پیج اینستاگرام)
      platform: 'web', // نشانگر پلتفرم
      sender: { id: guestId }, // آی‌دی مهمان
      message: { text: message },
    };

    // ارسال به پردازشگر (بدون await تا کاربر معطل نشود)
    processor.handleMessage(webEvent, webEvent); // فرمت کمی متفاوت است، باید پروسسور را سازگار کنیم

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
