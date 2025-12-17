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

module.exports = router;
