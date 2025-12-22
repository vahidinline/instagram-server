const express = require('express');
const router = express.Router();
const Campaign = require('../models/Campaign'); // <--- اطمینان از وجود این خط
const Triggers = require('../models/Triggers'); // <--- اطمینان از وجود این خط
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// 1. لیست کمپین‌ها
router.get('/', async (req, res) => {
  try {
    const { ig_accountId } = req.query;
    if (!ig_accountId)
      return res.status(400).json({ error: 'Missing Account ID' });

    const campaigns = await Campaign.find({ ig_accountId })
      .sort({ created_at: -1 })
      // Populate کردن نام فلوها برای نمایش در لیست
      .populate('ab_testing.variant_a.flow_id', 'name')
      .populate('ab_testing.variant_b.flow_id', 'name');

    res.json(campaigns);
  } catch (e) {
    console.error('Get Campaigns Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ...

// 2. ساخت کمپین جدید + تریگر متصل
// ... (ابتدای فایل و ایمپورت‌ها مثل قبل)

// 2. ساخت کمپین جدید + تریگر متصل
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

    // اعتبارسنجی
    if (!ig_accountId || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // پردازش کلمات کلیدی
    let processedKeywords = [];
    if (Array.isArray(keywords)) {
      processedKeywords = keywords.map((k) =>
        k.toString().toLowerCase().trim()
      );
    } else if (typeof keywords === 'string') {
      processedKeywords = keywords
        .split(',')
        .map((k) => k.trim().toLowerCase());
    }

    // *** اصلاح حیاتی برای A/B Testing ***
    let finalAB = ab_testing || {};

    // اصلاح Variant A
    if (finalAB.variant_a) {
      if (typeof finalAB.variant_a === 'string') {
        finalAB.variant_a = { flow_id: finalAB.variant_a };
      }
      // اگر آیدی خالی بود، اصلا آبجکت رو نذار
      if (!finalAB.variant_a.flow_id) delete finalAB.variant_a;
    }

    // اصلاح Variant B (علت اصلی ارور)
    if (finalAB.variant_b) {
      if (typeof finalAB.variant_b === 'string') {
        finalAB.variant_b = { flow_id: finalAB.variant_b };
      }
      // اگر رشته خالی بود ("")، کلا حذفش کن
      if (!finalAB.variant_b.flow_id) {
        delete finalAB.variant_b;
      }
    }

    // اگر A/B کلاً غیرفعال بود، درصد را ریست کن
    if (!finalAB.enabled) {
      finalAB.split_percentage = 100; // همه برن سمت A (اگر A باشه)
      delete finalAB.variant_b; // B رو حذف کن
    }
    // ************************************

    // 1. ساخت کمپین
    const newCampaign = await Campaign.create({
      app_userId: req.user.id,
      ig_accountId,
      name,
      media_id: media_id || null,
      media_url,
      keywords: processedKeywords,
      ab_testing: finalAB, // دیتای تمیز شده
      schedule,
      limits,
    });

    // 2. ساخت تریگر مخفی
    // (فقط اگر نسخه A وجود داشت تریگر بساز)
    if (finalAB.variant_a && finalAB.variant_a.flow_id) {
      const flowIdString =
        typeof finalAB.variant_a.flow_id === 'object'
          ? finalAB.variant_a.flow_id.toString()
          : finalAB.variant_a.flow_id;

      await Triggers.create({
        app_userId: req.user.id,
        ig_accountId,
        keywords: processedKeywords,
        match_type: 'contains',
        media_id: media_id || null,
        flow_id: flowIdString,
        campaign_id: newCampaign._id,
        type: 'both',
        is_active: true,
      });
      console.log(`✅ Campaign Trigger Created for: ${name}`);
    }

    res.json(newCampaign);
  } catch (e) {
    console.error('Create Campaign Error:', e);
    res.status(500).json({ error: 'خطا در ساخت کمپین: ' + e.message });
  }
});

// ... (بقیه روت‌ها بدون تغییر)

// ... (بقیه فایل بدون تغییر)

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

// 4. حذف کمپین (و تریگرهای مرتبط)
router.delete('/:id', async (req, res) => {
  try {
    // حذف خود کمپین
    const campaign = await Campaign.findByIdAndDelete(req.params.id);

    if (campaign) {
      // حذف تریگرهای متصل به این کمپین
      await Triggers.deleteMany({ campaign_id: req.params.id });
      console.log(`🗑️ Campaign & Triggers deleted: ${req.params.id}`);
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
