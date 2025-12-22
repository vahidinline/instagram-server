const express = require('express');
const router = express.Router();
const Campaign = require('../models/Campaign');
const Triggers = require('../models/Triggers');
const MessageLog = require('../models/MessageLogs');
const Lead = require('../models/Lead');
const authMiddleware = require('../middleware/auth');
const mongoose = require('mongoose');

router.use(authMiddleware);

// --- تابع کمکی برای استخراج ID تمیز ---
const getSafeId = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value.flow_id) return getSafeId(value.flow_id);
  if (value._id) return value._id.toString();
  return value.toString();
};

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

// 2. دریافت آمار دقیق یک کمپین (جدید 📊)
router.get('/:id/stats', async (req, res) => {
  try {
    const campaignId = req.params.id;
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // پیدا کردن تریگر متصل به این کمپین
    const trigger = await Triggers.findOne({ campaign_id: campaignId });

    let stats = {
      total_engagements: 0, // تعداد کل تعاملات (کامنت)
      replies_sent: 0, // تعداد پاسخ‌های موفق
      leads_generated: 0, // لیدهای جذب شده در بازه کمپین
      conversion_rate: 0,
    };

    if (trigger) {
      // شمارش تعداد دفعاتی که این تریگر فعال شده (از روی لاگ پیام‌های خروجی)
      stats.replies_sent = await MessageLog.countDocuments({
        triggered_by: trigger._id,
        direction: 'outgoing',
      });

      // تخمین تعاملات (پیام‌های ورودی مرتبط که باعث تریگر شدند)
      // (چون ما trigger_id رو روی incoming نمیزنیم، فعلا برابر با خروجی میگیریم یا کمی بیشتر)
      stats.total_engagements = stats.replies_sent;

      // محاسبه لیدهای جذب شده در بازه زمانی فعالیت کمپین
      // (اگر کمپین هنوز فعال است، تا الان. اگر تمام شده، تا زمان پایان)
      const startDate = campaign.created_at;
      const endDate = campaign.schedule?.endDate || new Date();

      stats.leads_generated = await Lead.countDocuments({
        ig_accountId: campaign.ig_accountId,
        created_at: { $gte: startDate, $lte: endDate },
      });

      // محاسبه نرخ تبدیل
      if (stats.total_engagements > 0) {
        stats.conversion_rate = (
          (stats.leads_generated / stats.total_engagements) *
          100
        ).toFixed(1);
      }
    }

    res.json(stats);
  } catch (e) {
    console.error('Campaign Stats Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 3. ساخت کمپین جدید
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

    if (!ig_accountId || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

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

    let finalAB = ab_testing || {};
    if (finalAB.variant_a && typeof finalAB.variant_a === 'string')
      finalAB.variant_a = { flow_id: finalAB.variant_a };
    if (finalAB.variant_b && typeof finalAB.variant_b === 'string')
      finalAB.variant_b = { flow_id: finalAB.variant_b };
    if (finalAB.variant_b && !finalAB.variant_b.flow_id)
      delete finalAB.variant_b;
    if (!finalAB.enabled) delete finalAB.variant_b;

    const newCampaign = await Campaign.create({
      app_userId: req.user.id,
      ig_accountId,
      name,
      media_id: media_id || null,
      media_url,
      keywords: processedKeywords,
      ab_testing: finalAB,
      schedule,
      limits,
    });

    const triggerFlowId = getSafeId(finalAB.variant_a?.flow_id);
    if (triggerFlowId) {
      await Triggers.create({
        app_userId: req.user.id,
        ig_accountId,
        keywords: processedKeywords,
        match_type: 'contains',
        media_id: media_id || null,
        flow_id: triggerFlowId,
        campaign_id: newCampaign._id,
        type: 'both',
        is_active: true,
      });
    }

    res.json(newCampaign);
  } catch (e) {
    console.error('Create Campaign Error:', e);
    res.status(500).json({ error: 'خطا در ساخت کمپین: ' + e.message });
  }
});

// 4. ویرایش کمپین
router.put('/:id', async (req, res) => {
  try {
    const {
      name,
      media_id,
      media_url,
      keywords,
      ab_testing,
      schedule,
      limits,
    } = req.body;

    let processedKeywords = [];
    if (Array.isArray(keywords)) {
      processedKeywords = keywords.map((k) =>
        k.toString().toLowerCase().trim()
      );
    }

    let finalAB = ab_testing || {};
    if (finalAB.variant_a && typeof finalAB.variant_a === 'string')
      finalAB.variant_a = { flow_id: finalAB.variant_a };
    if (finalAB.variant_b && typeof finalAB.variant_b === 'string')
      finalAB.variant_b = { flow_id: finalAB.variant_b };
    if (finalAB.variant_b && !finalAB.variant_b.flow_id)
      delete finalAB.variant_b;
    if (!finalAB.enabled) delete finalAB.variant_b;

    const updatedCampaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      {
        name,
        media_id,
        media_url,
        keywords: processedKeywords,
        ab_testing: finalAB,
        schedule,
        limits,
      },
      { new: true }
    );

    if (!updatedCampaign)
      return res.status(404).json({ error: 'Campaign not found' });

    const triggerFlowId = getSafeId(finalAB.variant_a?.flow_id);
    if (triggerFlowId) {
      await Triggers.findOneAndUpdate(
        { campaign_id: req.params.id },
        {
          keywords: processedKeywords,
          media_id: media_id || null,
          flow_id: triggerFlowId,
          is_active: true,
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }

    res.json(updatedCampaign);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. حذف کمپین
router.delete('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndDelete(req.params.id);
    if (campaign) {
      await Triggers.deleteMany({ campaign_id: req.params.id });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
