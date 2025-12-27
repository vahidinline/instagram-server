const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const MessageLog = require('../models/MessageLogs');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// روت پیشرفته برای قیف فروش و مقایسه پرسوناها
router.get('/advanced', async (req, res) => {
  try {
    const { ig_accountId, days = 7, personaId } = req.query;

    if (!ig_accountId)
      return res.status(400).json({ error: 'Account ID required' });

    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));

    // 1. ساخت کوئری پایه برای AnalyticsEvents
    let eventQuery = {
      ig_accountId,
      created_at: { $gte: since },
    };

    // فیلتر بر اساس پرسونا (اگر انتخاب شده باشد)
    if (personaId && personaId !== 'all') {
      eventQuery.persona_id = new mongoose.Types.ObjectId(personaId);
    }

    // 2. تجمیع دیتا برای قیف فروش (بر اساس ایونت‌ها)
    // ما تعداد کاربران یکتا (Unique Users) را در هر مرحله می‌شماریم
    const funnelRaw = await AnalyticsEvent.aggregate([
      { $match: eventQuery },
      {
        $group: {
          _id: '$eventType', // گروه بندی بر اساس نوع ایونت
          uniqueUsers: { $addToSet: '$user_id' }, // جمع آوری شناسه کاربران یکتا
          count: { $sum: 1 }, // تعداد کل دفعات وقوع
        },
      },
    ]);

    // تابع کمکی برای استخراج عدد
    const getVal = (type) => {
      const found = funnelRaw.find((f) => f._id === type);
      return found ? found.uniqueUsers.length : 0;
    };

    // 3. محاسبه مرحله اول قیف (Engagement)
    // اگر فیلتر پرسونا نداشتیم، از جدول پیام‌ها می‌خوانیم (دقیق‌تر)
    // اگر داشتیم، از ایونت ENGAGEMENT استفاده می‌کنیم (که در هندلر جدید اضافه کردیم)
    let uniqueVisitors = 0;

    // تعداد افرادی که پیام دادند
    if (personaId && personaId !== 'all') {
      uniqueVisitors = getVal('ENGAGEMENT');
    } else {
      const visitors = await MessageLog.distinct('sender_id', {
        ig_accountId,
        created_at: { $gte: since },
        direction: 'incoming',
      });
      uniqueVisitors = visitors.length;
    }

    // 4. ساخت آرایه نهایی قیف برای Recharts
    const funnel = [
      {
        name: 'شروع تعامل',
        value: uniqueVisitors,
        fill: '#6366f1',
        step: 'Start',
        description: 'کاربرانی که پیام فرستادند',
      },
      {
        name: 'مشاهده محصول',
        value: getVal('PRODUCT_FOUND'), // کسانی که محصول دیدند
        fill: '#8b5cf6',
        step: 'Discovery',
        description: 'محصولی به آنها پیشنهاد شد',
      },
      {
        name: 'دریافت لینک خرید',
        value: getVal('LINK_GENERATED'), // کسانی که لینک گرفتند (Intent)
        fill: '#ec4899',
        step: 'Intent',
        description: 'سفارش موفق ثبت شد',
      },
      {
        name: 'لید (ناموجود)',
        value: getVal('LEAD_CAPTURED'),
        fill: '#f59e0b',
        step: 'Lead',
        description: 'کالا موجود نبود و لید شدند',
      },
    ];

    // 5. آمار نمودار خطی (Activity Chart)
    const activityData = await MessageLog.aggregate([
      {
        $match: {
          ig_accountId,
          direction: 'outgoing',
          created_at: { $gte: since },
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
          human: { $sum: { $cond: [{ $eq: ['$status', 'replied'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // 6. آمار کلی (KPI)
    const kpi = {
      totalMessages: await MessageLog.countDocuments({
        ig_accountId,
        created_at: { $gte: since },
      }),
      totalOrders: getVal('LINK_GENERATED'),
      totalLeads: getVal('LEAD_CAPTURED'),
      conversionRate:
        uniqueVisitors > 0
          ? ((getVal('LINK_GENERATED') / uniqueVisitors) * 100).toFixed(1)
          : 0,
    };

    res.json({
      funnel,
      activityChart: activityData,
      kpi,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
