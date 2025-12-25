const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendOTP } = require('../utils/smsProvider'); // مطمئن شوید این فایل وجود دارد

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// --- متد ۱: ورود با گوگل ---
exports.googleLogin = async (req, res) => {
  try {
    const { token } = req.body;

    // اعتبارسنجی با گوگل
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, picture, sub: googleId } = payload;

    // جستجو یا ساخت کاربر
    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        email,
        name,
        avatar: picture,
        googleId,
        role: 'user',
      });
    } else {
      // آپدیت اطلاعات جدید گوگل
      user.name = name;
      user.avatar = picture;
      if (!user.googleId) user.googleId = googleId;
      await user.save();
    }

    sendTokenResponse(user, res);
  } catch (error) {
    console.error('Google Auth Error:', error);
    res.status(401).json({ success: false, message: 'Invalid Google Token' });
  }
};

// --- متد ۲: ارسال کد پیامک ---
exports.sendOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone)
      return res.status(400).json({ error: 'شماره موبایل الزامی است' });

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expires = new Date(Date.now() + 2 * 60 * 1000); // 2 دقیقه

    let user = await User.findOne({ phone });
    if (!user) {
      user = new User({ phone });
    }

    user.otp = code;
    user.otpExpires = expires;
    await user.save();

    // ارسال واقعی پیامک
    await sendOTP(phone, code);

    res.json({ success: true, message: 'کد تایید ارسال شد' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};

// --- متد ۳: تایید کد پیامک ---
exports.verifyOtp = async (req, res) => {
  try {
    const { phone, code } = req.body;
    const user = await User.findOne({ phone });

    if (!user || user.otp !== code) {
      return res.status(400).json({ error: 'کد وارد شده اشتباه است' });
    }

    if (user.otpExpires < new Date()) {
      return res.status(400).json({ error: 'کد منقضی شده است' });
    }

    // پاک کردن کد مصرف شده
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    sendTokenResponse(user, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// --- متد ۴: دریافت پروفایل (Me) ---
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-otp -otpExpires');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// --- متد ۵: آپدیت پروفایل ---
exports.updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { name, email },
      { new: true, runValidators: true }
    ).select('-otp -otpExpires');
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// --- تابع کمکی تولید توکن ---
const sendTokenResponse = (user, res) => {
  const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, {
    expiresIn: '30d',
  });

  res.status(200).json({
    success: true,
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      role: user.role,
      plan: user.plan,
    },
  });
};
