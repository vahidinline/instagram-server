const express = require('express');
const router = express.Router();
const MessageLog = require('../models/MessageLogs');

router.get('/stats', async (req, res) => {
  const { ig_accountId } = req.query;

  try {
    // 1. آمار کلی (کارت‌ها)
    const totalReceived = await MessageLog.countDocuments({
      ig_accountId,
      direction: 'incoming',
    });
    const totalReplied = await MessageLog.countDocuments({
      ig_accountId,
      direction: 'outgoing',
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayActivity = await MessageLog.countDocuments({
      ig_accountId,
      created_at: { $gte: startOfToday },
    });

    // 2. آمار نمودار (۷ روز گذشته)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const chartData = await MessageLog.aggregate([
      {
        $match: {
          ig_accountId: ig_accountId,
          created_at: { $gte: sevenDaysAgo },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
          in: { $sum: { $cond: [{ $eq: ['$direction', 'incoming'] }, 1, 0] } },
          out: { $sum: { $cond: [{ $eq: ['$direction', 'outgoing'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // فرمت کردن دیتا برای نمودار (پر کردن روزهای خالی)
    const formattedChart = chartData.map((item) => ({
      name: item._id, // تاریخ (مثلا 2025-01-20)
      in: item.in,
      out: item.out,
    }));

    res.json({
      total_messages: totalReceived,
      bot_replies: totalReplied,
      today_activity: todayActivity,
      chart: formattedChart, // <--- دیتای نمودار اضافه شد
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
