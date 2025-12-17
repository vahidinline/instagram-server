const express = require('express');
const router = express.Router();
const axios = require('axios');
const IGConnections = require('../models/IG-Connections');
const authMiddleware = require('../middleware/auth'); // میدل‌ویر امنیتی

// 1. ساخت لینک اتصال (فقط برای کاربر لاگین شده)
router.get('/connect-url', authMiddleware, (req, res) => {
  // ما آی‌دی کاربر را از توکن JWT استخراج می‌کنیم (req.user.id)
  const systemUserId = req.user.id;

  const scopes = [
    'instagram_business_basic',
    'instagram_business_manage_messages',
    'instagram_business_manage_comments',
  ].join(',');

  // *** نکته امنیتی و حیاتی ***
  // ما آی‌دی کاربر سیستم را در پارامتر state می‌گذاریم
  // تا وقتی از اینستاگرام برگشت، بدانیم این اکانت مال کیست
  const stateData = JSON.stringify({ systemUserId: systemUserId });
  const state = encodeURIComponent(stateData);

  const url = `https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1&client_id=${process.env.INSTAGRAM_CLIENT_ID}&redirect_uri=${process.env.INSTAGRAM_REDIRECT_URI}&response_type=code&scope=${scopes}&state=${state}`;

  res.json({ url });
});

// 2. کال‌بک و ذخیره اتصال
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (!code)
    return res.redirect(`${FRONTEND_URL}/accounts?status=error&msg=NoCode`);

  try {
    // بازگشایی بسته state برای پیدا کردن صاحب اکانت
    const decodedState = JSON.parse(decodeURIComponent(state));
    const systemUserId = decodedState.systemUserId;

    if (!systemUserId) {
      throw new Error('User ID missing in state');
    }

    // A. دریافت توکن کوتاه مدت
    const formData = new URLSearchParams();
    formData.append('client_id', process.env.INSTAGRAM_CLIENT_ID);
    formData.append('client_secret', process.env.INSTAGRAM_CLIENT_SECRET);
    formData.append('grant_type', 'authorization_code');
    formData.append('redirect_uri', process.env.INSTAGRAM_REDIRECT_URI);
    formData.append('code', code.replace(/#_$/, ''));

    const shortResp = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      formData
    );
    const shortToken = shortResp.data.access_token;

    // B. دریافت توکن بلند مدت
    const longResp = await axios.get(
      'https://graph.instagram.com/access_token',
      {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: process.env.INSTAGRAM_CLIENT_SECRET,
          access_token: shortToken,
        },
      }
    );
    const longToken = longResp.data.access_token;
    const expiresIn = longResp.data.expires_in;

    // C. دریافت پروفایل اینستاگرام
    const profileResp = await axios.get(
      `https://graph.instagram.com/v22.0/me`,
      {
        params: {
          fields: 'user_id,username,name,profile_picture_url',
          access_token: longToken,
        },
      }
    );
    const profile = profileResp.data;

    // D. ذخیره در دیتابیس (متصل به User)
    await IGConnections.findOneAndUpdate(
      { ig_userId: profile.user_id || profile.id }, // شرط جستجو
      {
        user_id: systemUserId, // <--- اتصال اکانت اینستا به کاربر SaaS
        ig_userId: profile.user_id || profile.id,
        username: profile.username,
        account_name: profile.name || profile.username,
        profile_picture_url: profile.profile_picture_url,
        access_token: longToken,
        token_expires_at: new Date(Date.now() + expiresIn * 1000),
        account_status: 'active',
        isActive: true,
      },
      { upsert: true, new: true }
    );

    console.log(
      `✅ Instagram Account @${profile.username} connected to User ID: ${systemUserId}`
    );

    // E. ریدایرکت به صفحه مدیریت اکانت‌ها در فرانت‌‌اند
    res.redirect(`${FRONTEND_URL}/accounts?status=success`);
  } catch (error) {
    console.error('Connect Error:', error.response?.data || error.message);
    res.redirect(
      `${FRONTEND_URL}/accounts?status=failed&msg=${encodeURIComponent(
        error.message
      )}`
    );
  }
});

module.exports = router;
