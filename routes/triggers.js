const express = require('express');
const router = express.Router();
const Triggers = require('../models/Triggers');
const authMiddleware = require('../middleware/auth'); // فرض بر این است که این میدل‌ویر وجود دارد

// 1. لیست تریگرها
router.get('/', async (req, res) => {
  try {
    const { ig_accountId } = req.query;
    if (!ig_accountId)
      return res.status(400).json({ error: 'Missing ig_accountId' });

    const triggers = await Triggers.find({ ig_accountId }).sort({ _id: -1 });
    res.json(triggers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. ساخت تریگر جدید (POST)
router.post('/', async (req, res) => {
  try {
    // *** تغییر مهم: دریافت media_id از بادی ***
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
      app_userId: 'admin_test', // یا req.user.id اگر میدل‌ویر دارید
      ig_accountId,
      keywords: keywordsArray,
      flow_id,
      match_type: match_type || 'contains',
      type: type || 'both',
      // *** ذخیره media_id ***
      media_id: media_id || null, // اگر نبود نال بذار
    });

    res.json(newTrigger);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. ویرایش تریگر (PUT)
router.put('/:id', async (req, res) => {
  try {
    // *** تغییر مهم: دریافت media_id در ویرایش ***
    const { keywords, flow_id, match_type, type, media_id } = req.body;

    let keywordsArray = keywords;
    if (typeof keywords === 'string') {
      keywordsArray = keywords
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k);
    }

    const updatedTrigger = await Triggers.findByIdAndUpdate(
      req.params.id,
      {
        keywords: keywordsArray,
        flow_id,
        match_type,
        type,
        // *** آپدیت media_id ***
        media_id: media_id || null,
      },
      { new: true }
    );
    res.json(updatedTrigger);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. حذف تریگر
router.delete('/:id', async (req, res) => {
  try {
    await Triggers.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
