const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendOTP } = require('../utils/smsProvider');

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// 1. درخواست کد تایید
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone)
      return res.status(400).json({ error: 'شماره موبایل الزامی است' });

    // تولید کد تصادفی ۴ رقمی
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expires = new Date(Date.now() + 2 * 60 * 1000); // اعتبار ۲ دقیقه

    // پیدا کردن یا ساختن کاربر (Upsert)
    let user = await User.findOne({ phone });
    if (!user) {
      user = new User({ phone });
    }

    // ذخیره کد در دیتابیس
    user.otp = code;
    user.otpExpires = expires;
    await user.save();

    // ارسال پیامک
    await sendOTP(phone, code);

    res.json({ success: true, message: 'کد تایید ارسال شد' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. تایید کد و ورود
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, code } = req.body;

    const user = await User.findOne({ phone });

    if (!user || user.otp !== code) {
      return res.status(400).json({ error: 'کد وارد شده اشتباه است' });
    }

    if (user.otpExpires < new Date()) {
      return res
        .status(400)
        .json({ error: 'کد منقضی شده است. مجدد تلاش کنید.' });
    }

    // پاک کردن کد بعد از استفاده موفق
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    // تولید توکن ورود
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      token,
      user: { id: user._id, phone: user.phone, name: user.name },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// دریافت اطلاعات کاربر
const authMiddleware = require('../middleware/auth');
router.get('/me', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json(user);
});

module.exports = router;
