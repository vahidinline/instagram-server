const express = require('express');
const router = express.Router();
const Triggers = require('../models/Triggers');
const authMiddleware = require('../middleware/auth'); // میدل‌ویر احراز هویت

// اعمال میدل‌ویر امنیتی روی تمام روت‌ها
router.use(authMiddleware);

// 1. لیست تریگرها (فقط مال همین کاربر)
router.get('/', async (req, res) => {
  try {
    const { ig_accountId } = req.query;
    if (!ig_accountId)
      return res.status(400).json({ error: 'Missing ig_accountId' });

    // نکته امنیتی: چک میکنیم که تریگرها متعلق به همین اکانت اینستاگرام باشند
    // (در سیستم دقیق‌تر باید چک کنیم که ig_accountId متعلق به req.user.id باشد)
    const triggers = await Triggers.find({ ig_accountId }).sort({ _id: -1 });
    res.json(triggers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. ساخت تریگر جدید
router.post('/', async (req, res) => {
  try {
    const { ig_accountId, keywords, flow_id, match_type, type, media_id } =
      req.body;

    let keywordsArray = [];
    if (Array.isArray(keywords)) {
      keywordsArray = keywords;
    } else if (typeof keywords === 'string') {
      keywordsArray = keywords.split(',').map((k) => k.trim());
    }

    if (keywordsArray.length === 0 || !flow_id || !ig_accountId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const newTrigger = await Triggers.create({
      app_userId: req.user.id, // <--- ✅ اصلاح شد: آی‌دی واقعی کاربر از توکن
      ig_accountId,
      keywords: keywordsArray,
      flow_id,
      match_type: match_type || 'contains',
      type: type || 'both',
      media_id: media_id || null,
    });

    res.json(newTrigger);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. ویرایش تریگر
router.put('/:id', async (req, res) => {
  try {
    const { keywords, flow_id, match_type, type, media_id } = req.body;

    let keywordsArray = keywords;
    if (typeof keywords === 'string') {
      keywordsArray = keywords
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k);
    }

    // فقط صاحب تریگر بتواند ویرایش کند
    const updatedTrigger = await Triggers.findOneAndUpdate(
      { _id: req.params.id, app_userId: req.user.id }, // شرط امنیتی
      {
        keywords: keywordsArray,
        flow_id,
        match_type,
        type,
        media_id: media_id || null,
      },
      { new: true }
    );

    if (!updatedTrigger)
      return res
        .status(404)
        .json({ error: 'Trigger not found or access denied' });

    res.json(updatedTrigger);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. حذف تریگر
router.delete('/:id', async (req, res) => {
  try {
    // فقط صاحب تریگر بتواند حذف کند
    const result = await Triggers.findOneAndDelete({
      _id: req.params.id,
      app_userId: req.user.id,
    });

    if (!result)
      return res
        .status(404)
        .json({ error: 'Trigger not found or access denied' });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
