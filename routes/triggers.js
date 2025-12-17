const express = require('express');
const router = express.Router();
const Triggers = require('../models/Triggers');

// 1. لیست کردن تمام تریگرهای یک اکانت
router.get('/', async (req, res) => {
  try {
    const { ig_accountId } = req.query; // فرانت باید آی‌دی پیج رو بفرسته
    if (!ig_accountId)
      return res.status(400).json({ error: 'Missing ig_accountId' });

    const triggers = await Triggers.find({ ig_accountId }).sort({ _id: -1 });
    res.json(triggers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. ساخت تریگر جدید
router.post('/', async (req, res) => {
  try {
    const { ig_accountId, keywords, flow_id, match_type, type } = req.body;

    // تبدیل ورودی به آرایه (اگر کاربر با کاما جدا کرده بود یا آرایه فرستاده بود)
    let keywordsArray = [];
    if (Array.isArray(keywords)) {
      keywordsArray = keywords;
    } else if (typeof keywords === 'string') {
      // مثلا کاربر میفرسته: "2, two, دو"
      keywordsArray = keywords.split(',').map((k) => k.trim());
    }

    if (keywordsArray.length === 0 || !flow_id || !ig_accountId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const newTrigger = await Triggers.create({
      app_userId: 'admin_test',
      ig_accountId,
      keywords: keywordsArray, // ذخیره آرایه
      flow_id,
      match_type: match_type || 'contains',
      type: type || 'dm',
      is_active: true,
    });

    res.json(newTrigger);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. حذف تریگر
router.delete('/:id', async (req, res) => {
  try {
    await Triggers.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. فعال/غیرفعال کردن
router.patch('/:id/toggle', async (req, res) => {
  try {
    const trigger = await Triggers.findById(req.params.id);
    trigger.is_active = !trigger.is_active;
    await trigger.save();
    res.json(trigger);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ویرایش تریگر (PUT)
router.put('/:id', async (req, res) => {
  try {
    const { keywords, flow_id, match_type, type } = req.body;

    // تبدیل کلمات کلیدی (اگر استرینگ بود به آرایه، اگر آرایه بود خودش)
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
      },
      { new: true }
    );
    res.json(updatedTrigger);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
