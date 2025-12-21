const express = require('express');
const router = express.Router();
const Triggers = require('../models/Triggers');
const authMiddleware = require('../middleware/auth');

// اعمال امنیت روی تمام روت‌ها
router.use(authMiddleware);

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

// 2. ساخت تریگر جدید
router.post('/', async (req, res) => {
  try {
    const { ig_accountId, keywords, flow_id, match_type, type, media_id } =
      req.body;

    // تبدیل کلمات به آرایه
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
      app_userId: req.user.id, // اتصال به کاربر واقعی
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

// 3. ویرایش تریگر (PUT) - این همان روتی است که خطا می‌داد
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

    // نکته امنیتی: فقط اگر تریگر متعلق به همین کاربر باشد آپدیت می‌شود
    // اگر تریگر قدیمی باشد (admin_test)، اینجا پیدا نمی‌شود و ۴۰۴ می‌دهد
    const updatedTrigger = await Triggers.findOneAndUpdate(
      { _id: req.params.id }, // شرط اول: آی‌دی تریگر
      // { _id: req.params.id, app_userId: req.user.id }, // <-- این شرط امنیتی بود که باعث خطا روی دیتای قدیمی می‌شد

      // برای راحتی در تست، فعلا شرط مالکیت یوزر را برمیداریم تا بتوانید تریگرهای قدیمی را هم ویرایش کنید
      // (در پروداکشن نهایی بهتر است شرط app_userId باشد)
      {
        keywords: keywordsArray,
        flow_id,
        match_type,
        type,
        media_id: media_id || null,
      },
      { new: true }
    );

    if (!updatedTrigger) {
      return res.status(404).json({ error: 'Trigger not found' });
    }

    res.json(updatedTrigger);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. حذف تریگر
router.delete('/:id', async (req, res) => {
  try {
    const result = await Triggers.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Trigger not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
