const express = require('express');
const router = express.Router();
const WebConnection = require('../models/WebConnection');
const authMiddleware = require('../middleware/auth');
const processor = require('../services/webhookProcessor');
const wooService = require('../services/wooService');

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
    const { channelId, guestId, message, metadata } = req.body;

    const metaLog = metadata
      ? `(On Product: ${metadata.productId || 'None'})`
      : '';
    console.log(`🌐 Web Widget: "${message}" from ${guestId} ${metaLog}`);

    const simulatedEntry = {
      id: channelId,
      platform: 'web',
      time: Date.now(),
      metadata: metadata || {},
    };

    const simulatedMessaging = {
      sender: { id: guestId },
      message: { text: message, is_echo: false },
    };

    processor.handleMessage(simulatedEntry, simulatedMessaging);

    res.json({ success: true });
  } catch (e) {
    console.error('Web Message Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 3. تست اتصال ووکامرس
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

// 4. لیست کانال‌های کاربر (همراه با نام پرسونا)
router.get('/web', authMiddleware, async (req, res) => {
  try {
    const channels = await WebConnection.find({
      user_id: req.user.id,
    }).populate('aiConfig.activePersonaId', 'name avatar'); // نام پرسونا را هم برگردان
    res.json(channels);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. ساخت کانال جدید
router.post('/web', authMiddleware, async (req, res) => {
  try {
    // activePersonaId را از بادی می‌گیریم
    const {
      name,
      siteUrl,
      consumerKey,
      consumerSecret,
      widgetConfig,
      activePersonaId,
    } = req.body;

    const newChannel = await WebConnection.create({
      user_id: req.user.id,
      name,
      siteUrl,
      consumerKey,
      consumerSecret,
      widgetConfig,
      aiConfig: {
        enabled: true,
        activePersonaId: activePersonaId || null, // ذخیره آی‌دی پرسونا
      },
    });
    res.json(newChannel);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 6. ویرایش کانال (برای تغییر پرسونا یا تنظیمات)
router.put('/web/:id', authMiddleware, async (req, res) => {
  try {
    const { name, widgetConfig, botConfig, activePersonaId } = req.body;

    // آپدیت فیلدها
    const updateData = {
      name,
      widgetConfig,
      botConfig,
    };

    // اگر پرسونا تغییر کرده بود
    if (activePersonaId !== undefined) {
      updateData['aiConfig.activePersonaId'] = activePersonaId;
    }

    const updated = await WebConnection.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user.id },
      { $set: updateData },
      { new: true }
    );

    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
