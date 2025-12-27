const express = require('express');
const router = express.Router();
const WebConnection = require('../models/WebConnection');
const authMiddleware = require('../middleware/auth');
const processor = require('../services/webhookProcessor');
const wooService = require('../services/wooService'); // برای روت تست

// ==========================================
// 🔓 روت‌های عمومی (Public)
// ==========================================

// 1. دریافت کانفیگ ویجت
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

// 2. دریافت پیام از ویجت (همراه با متادیتا)
router.post('/web/message', async (req, res) => {
  try {
    // دریافت metadata (شامل productId و url) از بادی درخواست
    const { channelId, guestId, message, metadata } = req.body;

    // لاگ برای دیباگ
    const metaLog = metadata
      ? `(On Product: ${metadata.productId || 'None'})`
      : '';
    console.log(`🌐 Web Widget: "${message}" from ${guestId} ${metaLog}`);

    const simulatedEntry = {
      id: channelId,
      platform: 'web',
      time: Date.now(),
      metadata: metadata || {}, // پاس دادن متادیتا به پردازشگر
    };

    const simulatedMessaging = {
      sender: { id: guestId },
      message: { text: message, is_echo: false },
    };

    // ارسال به پردازشگر مرکزی
    processor.handleMessage(simulatedEntry, simulatedMessaging);

    res.json({ success: true });
  } catch (e) {
    console.error('Web Message Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 3. تست اتصال ووکامرس (برای دیباگ)
router.get('/test-woo/:id', async (req, res) => {
  try {
    const channelId = req.params.id;
    const query = req.query.q || 'test';
    const connection = await WebConnection.findById(channelId);
    if (!connection)
      return res.status(404).json({ error: 'Channel not found' });

    const result = await wooService.searchProducts(connection, query);
    res.json({ site: connection.siteUrl, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// 🔒 روت‌های خصوصی (Private - Admin)
// ==========================================

// 4. لیست کانال‌های کاربر
router.get('/web', authMiddleware, async (req, res) => {
  try {
    const channels = await WebConnection.find({ user_id: req.user.id });
    res.json(channels);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. ساخت کانال جدید
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
