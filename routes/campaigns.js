const express = require('express');
const router = express.Router();
const Campaign = require('../models/Campaign');
const authMiddleware = require('../middleware/auth');
const Triggers = require('../models/Triggers');
router.use(authMiddleware);

// 1. لیست کمپین‌ها
router.get('/', async (req, res) => {
  try {
    const { ig_accountId } = req.query;
    if (!ig_accountId)
      return res.status(400).json({ error: 'Missing Account ID' });

    const campaigns = await Campaign.find({ ig_accountId })
      .sort({ created_at: -1 })
      .populate('ab_testing.variant_a.flow_id', 'name')
      .populate('ab_testing.variant_b.flow_id', 'name');

    res.json(campaigns);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. ساخت کمپین جدید
router.post('/', async (req, res) => {
  try {
    const {
      ig_accountId,
      name,
      media_id,
      media_url,
      keywords,
      ab_testing,
      schedule,
      limits,
    } = req.body;

    // 1. ساخت کمپین
    const newCampaign = await Campaign.create({
      app_userId: req.user.id,
      ig_accountId,
      name,
      media_id,
      media_url,
      keywords: keywords.map((k) => k.toLowerCase().trim()),
      ab_testing,
      schedule,
      limits,
    });

    // 2. ساخت تریگر مخفی متصل به کمپین
    // (از فلو A به عنوان پیش‌فرض استفاده می‌کنیم، لاجیک A/B در پروسسور هندل می‌شود)
    await Triggers.create({
      app_userId: req.user.id,
      ig_accountId,
      keywords: keywords.map((k) => k.toLowerCase().trim()),
      match_type: 'contains', // یا دقیق، بسته به نیاز
      media_id,
      flow_id: ab_testing.variant_a, // وصل کردن به فلو A
      campaign_id: newCampaign._id, // <--- اتصال حیاتی!
      type: 'both', // کمپین‌ها معمولا روی کامنت هستند
    });

    res.json(newCampaign);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. تغییر وضعیت (Pause/Active)
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    res.json(campaign);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. حذف
router.delete('/:id', async (req, res) => {
  try {
    await Campaign.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
