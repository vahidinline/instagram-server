const express = require('express');
const router = express.Router();
const axios = require('axios');
const IGConnections = require('../models/IG-Connections');
const authMiddleware = require('../middleware/auth');

// 1. دریافت لیست اکانت‌های کاربر
router.get('/', authMiddleware, async (req, res) => {
  try {
    const accounts = await IGConnections.find({ user_id: req.user.id });
    res.json(accounts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server Error' });
  }
});

// 2. دریافت تنظیمات یک اکانت خاص
router.get('/:igId/settings', authMiddleware, async (req, res) => {
  try {
    const account = await IGConnections.findOne({
      ig_userId: req.params.igId,
      user_id: req.user.id,
    });

    if (!account) return res.status(404).json({ error: 'Account not found' });

    res.json(account.botConfig);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. آپدیت تنظیمات (شامل تنظیمات AI)
router.put('/:igId/settings', authMiddleware, async (req, res) => {
  try {
    const {
      isActive,
      responseDelay,
      publicReplyText,
      checkFollow,
      followWarning,
      aiConfig,
    } = req.body;

    const updateData = {
      'botConfig.isActive': isActive,
      'botConfig.responseDelay': responseDelay,
      'botConfig.publicReplyText': publicReplyText,
      'botConfig.checkFollow': checkFollow,
      'botConfig.followWarning': followWarning,
    };

    // فقط اگر aiConfig ارسال شده بود آپدیتش کن
    if (aiConfig) {
      updateData['aiConfig'] = aiConfig;
    }

    const account = await IGConnections.findOneAndUpdate(
      { ig_userId: req.params.igId, user_id: req.user.id },
      { $set: updateData },
      { new: true }
    );

    if (!account) return res.status(404).json({ error: 'Account not found' });

    res.json(account);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. دریافت لیست پست‌های اینستاگرام (Media) - *** جدید ***
router.get('/:igId/media', authMiddleware, async (req, res) => {
  try {
    const account = await IGConnections.findOne({
      ig_userId: req.params.igId,
      user_id: req.user.id,
    });

    if (!account) return res.status(404).json({ error: 'Account not found' });

    // درخواست به Graph API
    const response = await axios.get(
      `https://graph.instagram.com/v22.0/${account.ig_userId}/media`,
      {
        params: {
          fields:
            'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp',
          limit: 50, // ۵۰ پست آخر
          access_token: account.access_token,
        },
      }
    );

    res.json(response.data.data);
  } catch (e) {
    console.error('Media Fetch Error:', e.response?.data || e.message);
    res.status(500).json({ error: 'Failed to fetch media from Instagram' });
  }
});

module.exports = router;
