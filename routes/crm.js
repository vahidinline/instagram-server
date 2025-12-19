const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const authMiddleware = require('../middleware/auth');

// 1. دریافت تمام مشتریان یک اکانت (برای نمایش در کانبان)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { ig_accountId } = req.query;
    if (!ig_accountId)
      return res.status(400).json({ error: 'Missing Account ID' });

    const customers = await Customer.find({ ig_accountId })
      .sort({ lastInteraction: -1 })
      .limit(200); // محدودیت برای پرفورمنس
    res.json(customers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. تغییر مرحله (Stage) مشتری (Drag & Drop Update)
router.put('/:id/stage', authMiddleware, async (req, res) => {
  try {
    const { stage } = req.body;

    // آپدیت استیج و اضافه کردن به تاریخچه
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      {
        $set: { stage: stage },
        $push: {
          stageHistory: {
            from: 'manual_drag', // یا استیج قبلی رو بگیریم
            to: stage,
            date: new Date(),
            reason: 'Moved manually in Kanban Board',
          },
        },
      },
      { new: true }
    );

    res.json(customer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
