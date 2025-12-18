const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendOTP } = require('../utils/smsProvider');
const authMiddleware = require('../middleware/auth'); // ایمپورت میدل‌ویر

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// 1. درخواست کد تایید
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone)
      return res.status(400).json({ error: 'شماره موبایل الزامی است' });

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expires = new Date(Date.now() + 2 * 60 * 1000);

    let user = await User.findOne({ phone });
    if (!user) {
      user = new User({ phone });
    }

    user.otp = code;
    user.otpExpires = expires;
    await user.save();

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
      return res.status(400).json({ error: 'کد منقضی شده است' });
    }

    user.otp = null;
    user.otpExpires = null;
    await user.save();

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, {
      expiresIn: '30d',
    });

    // *** تغییر مهم: ارسال role به فرانت‌‌اند ***
    res.json({
      token,
      user: {
        id: user._id,
        phone: user.phone,
        name: user.name,
        email: user.email,
        role: user.role, // <--- این خط حیاتی بود که نبود!
        plan: user.plan,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. دریافت اطلاعات کاربر جاری (Me)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -otp');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. ویرایش پروفایل
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { name, email } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { name, email },
      { new: true, runValidators: true }
    ).select('-password -otp -otpExpires');

    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
