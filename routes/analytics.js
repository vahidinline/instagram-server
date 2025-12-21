const express = require('express');
const router = express.Router();
const MessageLog = require('../models/MessageLogs');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const authMiddleware = require('../middleware/auth');

router.get('/advanced', authMiddleware, async (req, res) => {
  try {
    const { ig_accountId, days = 7 } = req.query; // پیش‌فرض ۷ روزه
    if (!ig_accountId)
      return res.status(400).json({ error: 'Missing Account ID' });

    const now = new Date();
    const past = new Date();
    past.setDate(now.getDate() - days);

    const previousPast = new Date();
    previousPast.setDate(past.getDate() - days); // برای مقایسه با دوره قبل

    // تابع کمکی برای محاسبه درصد رشد
    const calcGrowth = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    // 1. KPI اصلی با مقایسه
    const getCount = async (Model, query) => await Model.countDocuments(query);

    // دوره جاری
    const currentMsgs = await getCount(MessageLog, {
      ig_accountId,
      direction: 'incoming',
      created_at: { $gte: past },
    });
    const currentLeads = await getCount(Lead, {
      ig_accountId,
      created_at: { $gte: past },
    });
    const currentSales = await getCount(Customer, {
      ig_accountId,
      stage: 'customer',
      lastInteraction: { $gte: past },
    });

    // دوره قبل (برای محاسبه رشد)
    const prevMsgs = await getCount(MessageLog, {
      ig_accountId,
      direction: 'incoming',
      created_at: { $gte: previousPast, $lt: past },
    });
    const prevLeads = await getCount(Lead, {
      ig_accountId,
      created_at: { $gte: previousPast, $lt: past },
    });
    const prevSales = await getCount(Customer, {
      ig_accountId,
      stage: 'customer',
      lastInteraction: { $gte: previousPast, $lt: past },
    });

    const kpi = {
      messages: {
        value: currentMsgs,
        growth: calcGrowth(currentMsgs, prevMsgs),
      },
      leads: {
        value: currentLeads,
        growth: calcGrowth(currentLeads, prevLeads),
      },
      sales: {
        value: currentSales,
        growth: calcGrowth(currentSales, prevSales),
      },
      aiRatio: 0, // پایین محاسبه میشه
    };

    // 2. نمودار ترکیبی (Human vs AI) در طول زمان
    const activityData = await MessageLog.aggregate([
      {
        $match: {
          ig_accountId,
          direction: 'outgoing',
          created_at: { $gte: past },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
          ai: {
            $sum: {
              $cond: [
                { $in: ['$status', ['replied_ai', 'processed_ai']] },
                1,
                0,
              ],
            },
          },
          human: { $sum: { $cond: [{ $eq: ['$status', 'replied'] }, 1, 0] } }, // replied معمولی یعنی فلو یا دستی
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // محاسبه نسبت کل AI
    const totalAI = activityData.reduce((acc, curr) => acc + curr.ai, 0);
    const totalHuman = activityData.reduce((acc, curr) => acc + curr.human, 0);
    kpi.aiRatio =
      totalAI + totalHuman > 0
        ? Math.round((totalAI / (totalAI + totalHuman)) * 100)
        : 0;

    // 3. قیف فروش (Funnel)
    const visitors = await Customer.countDocuments({ ig_accountId });
    const interested = await Customer.countDocuments({
      ig_accountId,
      stage: { $ne: 'lead' },
    }); // هرکی از لید رد شده
    const ready = await Customer.countDocuments({
      ig_accountId,
      stage: { $in: ['ready_to_buy', 'negotiation', 'customer'] },
    });
    const customers = await Customer.countDocuments({
      ig_accountId,
      stage: 'customer',
    });

    const funnel = [
      { name: 'بازدیدکننده', value: visitors, fill: '#6366f1' },
      { name: 'درگیر شده', value: interested, fill: '#8b5cf6' },
      { name: 'آماده خرید', value: ready, fill: '#ec4899' },
      { name: 'خریدار', value: customers, fill: '#10b981' },
    ];

    // 4. فعالیت‌های اخیر (Live Feed)
    const recentActivity = await MessageLog.find({ ig_accountId })
      .sort({ created_at: -1 })
      .limit(10)
      .select('sender_username message_type status created_at content');

    res.json({ kpi, activityChart: activityData, funnel, recentActivity });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
