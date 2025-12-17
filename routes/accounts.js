const express = require('express');
const router = express.Router();
const IGConnections = require('../models/IG-Connections');
const authMiddleware = require('../middleware/auth'); // میدل‌ویر JWT

// دریافت لیست اکانت‌های متصل به کاربر لاگین شده
router.get('/', authMiddleware, async (req, res) => {
  try {
    // req.user.id از توکن JWT میاد
    const accounts = await IGConnections.find({ user_id: req.user.id });

    res.json(accounts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server Error' });
  }
});

// ... (imports)

// 1. دریافت تنظیمات یک اکانت خاص
router.get('/:igId/settings', authMiddleware, async (req, res) => {
  try {
    const account = await IGConnections.findOne({
      ig_userId: req.params.igId,
      user_id: req.user.id,
    });

    if (!account) return res.status(404).json({ error: 'Account not found' });

    res.json(account.botConfig);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. آپدیت تنظیمات
router.put('/:igId/settings', authMiddleware, async (req, res) => {
  try {
    const { isActive, responseDelay, aiConfig } = req.body;

    const account = await IGConnections.findOneAndUpdate(
      { ig_userId: req.params.igId, user_id: req.user.id },
      {
        $set: {
          'botConfig.isActive': isActive,
          'botConfig.responseDelay': responseDelay,
          aiConfig: aiConfig,
        },
      },
      { new: true }
    );

    if (!account) return res.status(404).json({ error: 'Account not found' });

    res.json(account.botConfig);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
