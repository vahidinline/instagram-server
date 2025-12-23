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

// 2. دریافت تنظیمات کامل (ربات + هوش مصنوعی) - *** اصلاح شده ***
router.get('/:igId/settings', authMiddleware, async (req, res) => {
  try {
    const account = await IGConnections.findOne({
      ig_userId: req.params.igId,
      user_id: req.user.id,
    }).populate('aiConfig.activePersonaId'); // اگر پرسونا دارد، آن را هم بیاور

    if (!account) return res.status(404).json({ error: 'Account not found' });

    // ترکیب تنظیمات ربات و هوش مصنوعی در یک آبجکت
    const settings = {
      // تنظیمات عمومی ربات (از botConfig)
      ...(account.botConfig || {}),

      // تنظیمات هوش مصنوعی (از aiConfig)
      aiConfig: account.aiConfig || { enabled: false, systemPrompt: '' },
    };

    // حذف مقادیر mongoose (مثل _id و toObject) برای تمیزی
    // (اینجا دستی ساختیم پس تمیز است)

    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. آپدیت تنظیمات (شامل تنظیمات AI) - *** اصلاح شده ***
router.put('/:igId/settings', authMiddleware, async (req, res) => {
  try {
    const {
      isActive,
      responseDelay,
      publicReplyText,
      checkFollow,
      followWarning, // فیلدهای botConfig
      aiConfig, // فیلد aiConfig (شامل enabled, prompt, persona)
    } = req.body;

    // ساخت آبجکت آپدیت داینامیک
    const updateData = {};

    // آپدیت فیلدهای botConfig (فقط اگر ارسال شده باشند)
    if (typeof isActive !== 'undefined')
      updateData['botConfig.isActive'] = isActive;
    if (typeof responseDelay !== 'undefined')
      updateData['botConfig.responseDelay'] = responseDelay;
    if (typeof publicReplyText !== 'undefined')
      updateData['botConfig.publicReplyText'] = publicReplyText;
    if (typeof checkFollow !== 'undefined')
      updateData['botConfig.checkFollow'] = checkFollow;
    if (typeof followWarning !== 'undefined')
      updateData['botConfig.followWarning'] = followWarning;

    // آپدیت فیلدهای aiConfig (فقط اگر ارسال شده باشند)
    if (aiConfig) {
      if (typeof aiConfig.enabled !== 'undefined')
        updateData['aiConfig.enabled'] = aiConfig.enabled;
      if (typeof aiConfig.systemPrompt !== 'undefined')
        updateData['aiConfig.systemPrompt'] = aiConfig.systemPrompt;
      if (typeof aiConfig.activePersonaId !== 'undefined')
        updateData['aiConfig.activePersonaId'] = aiConfig.activePersonaId;
      if (typeof aiConfig.strictMode !== 'undefined')
        updateData['aiConfig.strictMode'] = aiConfig.strictMode;
      if (typeof aiConfig.creativity !== 'undefined')
        updateData['aiConfig.creativity'] = aiConfig.creativity;
    }

    const account = await IGConnections.findOneAndUpdate(
      { ig_userId: req.params.igId, user_id: req.user.id },
      { $set: updateData },
      { new: true }
    );

    if (!account) return res.status(404).json({ error: 'Account not found' });

    // بازگشت فرمت ترکیبی (مثل GET)
    const settings = {
      ...(account.botConfig || {}),
      aiConfig: account.aiConfig || {},
    };

    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. دریافت مدیا
router.get('/:igId/media', authMiddleware, async (req, res) => {
  try {
    const account = await IGConnections.findOne({
      ig_userId: req.params.igId,
      user_id: req.user.id,
    });

    if (!account) return res.status(404).json({ error: 'Account not found' });

    const response = await axios.get(
      `https://graph.instagram.com/v22.0/${account.ig_userId}/media`,
      {
        params: {
          fields:
            'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp',
          limit: 50,
          access_token: account.access_token,
        },
      }
    );

    res.json(response.data.data);
  } catch (e) {
    // console.error('Media Fetch Error:', e.response?.data || e.message);
    // اگر ارور داد آرایه خالی بده که پنل کرش نکنه
    res.json([]);
  }
});

// 5. حذف (قطع اتصال) اکانت
router.delete('/:igId', authMiddleware, async (req, res) => {
  try {
    const { igId } = req.params;

    // فقط اکانتی که متعلق به همین کاربر است را پاک کن (امنیت)
    const result = await IGConnections.findOneAndDelete({
      ig_userId: igId,
      user_id: req.user.id,
    });

    if (!result) {
      return res
        .status(404)
        .json({ error: 'Account not found or access denied' });
    }

    // اختیاری: پاک کردن لاگ‌ها و تریگرهای مربوط به این اکانت
    // await Triggers.deleteMany({ ig_accountId: igId });
    // await MessageLog.deleteMany({ ig_accountId: igId });
    // (فعلا پاک نمیکنیم تا دیتا از دست نرود، فقط اتصال قطع میشود)

    res.json({ success: true, message: 'Account disconnected' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
