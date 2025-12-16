const express = require('express');
const router = express.Router();
const axios = require('axios');
const IGConnections = require('../models/IG-Connections');

// 1. ساخت لینک لاگین
router.get('/login-url', (req, res) => {
  const { userId } = req.query;

  const scopes = [
    'instagram_business_basic',
    'instagram_business_manage_messages',
    'instagram_business_manage_comments',
    'instagram_business_content_publish',
  ].join(',');

  // استفاده از encodeURIComponent برای جلوگیری از خطای 429 و فرمت صحیح
  const state = encodeURIComponent(JSON.stringify({ app_userId: userId }));

  const url = `https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1&client_id=${process.env.INSTAGRAM_CLIENT_ID}&redirect_uri=${process.env.INSTAGRAM_REDIRECT_URI}&response_type=code&scope=${scopes}&state=${state}`;

  res.json({ url });
});

// 2. کال‌بک و ریدایرکت به فرانت‌‌اند
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) return res.status(400).send('No code received');

  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

  try {
    const decodedState = state ? JSON.parse(decodeURIComponent(state)) : {};
    const appUserId = decodedState.app_userId || 'unknown_user';

    // A. دریافت Short-Lived Token
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

    // B. تبدیل به Long-Lived Token
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

    // C. دریافت پروفایل کاربر
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

    // D. ذخیره در دیتابیس
    const savedUser = await IGConnections.findOneAndUpdate(
      { ig_userId: profile.user_id || profile.id },
      {
        app_userId: appUserId,
        ig_userId: profile.user_id || profile.id,
        username: profile.username,
        account_name: profile.name || profile.username,
        profile_picture_url: profile.profile_picture_url,
        access_token: longToken,
        token_expires_at: new Date(Date.now() + expiresIn * 1000),
        account_status: 'active',
      },
      { upsert: true, new: true }
    );

    console.log(`✅ Login Success for: ${savedUser.username}`);

    // E. ریدایرکت به فرانت‌‌اند با اطلاعات کاربر
    const userData = encodeURIComponent(
      JSON.stringify({
        ig_userId: savedUser.ig_userId,
        username: savedUser.username,
        name: savedUser.account_name,
        profile_picture: savedUser.profile_picture_url,
      })
    );

    res.redirect(`${FRONTEND_URL}/login?status=success&data=${userData}`);
  } catch (error) {
    console.error('Login Error:', error.response?.data || error.message);
    res.redirect(`${FRONTEND_URL}/login?status=failed`);
  }
});

module.exports = router;
