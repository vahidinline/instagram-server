// const express = require('express');
// const router = express.Router();
// const axios = require('axios');
// const IGConnections = require('../models/IG-Connections');
// const authMiddleware = require('../middleware/auth');
// const { googleLogin } = require('../controllers/authController');
// // 1. ساخت لینک اتصال
// router.get('/connect-url', authMiddleware, (req, res) => {
//   const systemUserId = req.user.id;
//   const scopes = [
//     'instagram_business_basic',
//     'instagram_business_manage_messages',
//     'instagram_business_manage_comments',
//   ].join(',');

//   const stateData = JSON.stringify({ systemUserId: systemUserId });
//   const state = encodeURIComponent(stateData);

//   const url = `https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1&client_id=${process.env.INSTAGRAM_CLIENT_ID}&redirect_uri=${process.env.INSTAGRAM_REDIRECT_URI}&response_type=code&scope=${scopes}&state=${state}`;

//   res.json({ url });
// });

// // 2. کال‌بک
// router.get('/callback', async (req, res) => {
//   const { code, state } = req.query;
//   const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

//   if (!code)
//     return res.redirect(`${FRONTEND_URL}/accounts?status=error&msg=NoCode`);

//   try {
//     const decodedState = JSON.parse(decodeURIComponent(state));
//     const systemUserId = decodedState.systemUserId;

//     if (!systemUserId) throw new Error('User ID missing');

//     // A. توکن کوتاه
//     const formData = new URLSearchParams();
//     formData.append('client_id', process.env.INSTAGRAM_CLIENT_ID);
//     formData.append('client_secret', process.env.INSTAGRAM_CLIENT_SECRET);
//     formData.append('grant_type', 'authorization_code');
//     formData.append('redirect_uri', process.env.INSTAGRAM_REDIRECT_URI);
//     formData.append('code', code.replace(/#_$/, ''));

//     const shortResp = await axios.post(
//       'https://api.instagram.com/oauth/access_token',
//       formData
//     );
//     const shortToken = shortResp.data.access_token;

//     // B. توکن بلند
//     const longResp = await axios.get(
//       'https://graph.instagram.com/access_token',
//       {
//         params: {
//           grant_type: 'ig_exchange_token',
//           client_secret: process.env.INSTAGRAM_CLIENT_SECRET,
//           access_token: shortToken,
//         },
//       }
//     );
//     const longToken = longResp.data.access_token;
//     const expiresIn = longResp.data.expires_in;

//     // C. پروفایل
//     const profileResp = await axios.get(
//       `https://graph.instagram.com/v22.0/me`,
//       {
//         params: {
//           fields: 'user_id,username,name,profile_picture_url',
//           access_token: longToken,
//         },
//       }
//     );
//     const profile = profileResp.data;
//     const igUserId = profile.user_id || profile.id;

//     // D. ذخیره در دیتابیس
//     await IGConnections.findOneAndUpdate(
//       { ig_userId: igUserId },
//       {
//         user_id: systemUserId,
//         ig_userId: igUserId,
//         username: profile.username,
//         account_name: profile.name || profile.username,
//         profile_picture_url: profile.profile_picture_url,
//         access_token: longToken,
//         token_expires_at: new Date(Date.now() + expiresIn * 1000),
//         account_status: 'active',
//         isActive: true,
//       },
//       { upsert: true, new: true }
//     );

//     // *** E. فعال‌سازی وب‌هوک (این بخش جدید و حیاتی است) ***
//     try {
//       await axios.post(
//         `https://graph.instagram.com/v22.0/${igUserId}/subscribed_apps`,
//         {
//           subscribed_fields: 'messages,comments',
//         },
//         {
//           params: { access_token: longToken },
//         }
//       );
//       console.log(`✅ Webhook Subscribed for @${profile.username}`);
//     } catch (subErr) {
//       console.error(
//         '❌ Webhook Subscription Failed:',
//         subErr.response?.data || subErr.message
//       );
//       // اینجا ارور را نادیده می‌گیریم تا لاگین کاربر خراب نشود، ولی در لاگ سرور ثبت می‌شود
//     }

//     res.redirect(`${FRONTEND_URL}/accounts?status=success`);
//   } catch (error) {
//     console.error('Connect Error:', error.response?.data || error.message);
//     res.redirect(
//       `${FRONTEND_URL}/accounts?status=failed&msg=${encodeURIComponent(
//         error.message
//       )}`
//     );
//   }
// });

// router.post('/google', googleLogin);

// module.exports = router;
const express = require('express');
const router = express.Router();
const axios = require('axios');
const IGConnections = require('../models/IG-Connections');
const authMiddleware = require('../middleware/auth');
const { googleLogin } = require('../controllers/authController');

// --- لیست دامنه‌های مجاز (برای امنیت) ---
// حتما آدرس‌های خودتان را اینجا دقیق وارد کنید (بدون اسلش آخر)
const ALLOWED_ORIGINS = [
  'https://businessbot.ir',
  'https://instabox.pages.dev',
  'http://localhost:5173', // پورت لوکال شما
  'http://localhost:3000',
];

// 1. ساخت لینک اتصال
router.get('/connect-url', authMiddleware, (req, res) => {
  const systemUserId = req.user.id;

  // *** دریافت آدرس فرانت‌‌اند از کوئری ***
  let origin = req.query.origin;

  // اگر آدرس فرستاده نشد یا در لیست مجاز نبود، از آدرس پیش‌فرض env استفاده کن
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    origin = process.env.FRONTEND_URL || 'http://localhost:5173';
  }

  const scopes = [
    'instagram_business_basic',
    'instagram_business_manage_messages',
    'instagram_business_manage_comments',
  ].join(',');

  // *** ذخیره آدرس بازگشت (returnUrl) در state ***
  const stateData = JSON.stringify({
    systemUserId: systemUserId,
    returnUrl: origin,
  });

  const state = encodeURIComponent(stateData);

  const url = `https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1&client_id=${process.env.INSTAGRAM_CLIENT_ID}&redirect_uri=${process.env.INSTAGRAM_REDIRECT_URI}&response_type=code&scope=${scopes}&state=${state}`;

  res.json({ url });
});

// 2. کال‌بک
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  // پیش‌فرض: اگر مشکلی بود به این آدرس برگرد
  let targetFrontend = process.env.FRONTEND_URL || 'http://localhost:5173';

  try {
    // بازگشایی state برای پیدا کردن آدرس فرانت‌‌اند
    if (state) {
      const decodedState = JSON.parse(decodeURIComponent(state));

      // اگر آدرس معتبر بود، تار겟 را عوض کن
      if (
        decodedState.returnUrl &&
        ALLOWED_ORIGINS.includes(decodedState.returnUrl)
      ) {
        targetFrontend = decodedState.returnUrl;
      }

      var systemUserId = decodedState.systemUserId; // متغیر برای استفاده در ادامه
    }

    if (!code)
      return res.redirect(`${targetFrontend}/accounts?status=error&msg=NoCode`);

    if (!systemUserId) throw new Error('User ID missing in state');

    // A. توکن کوتاه
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

    // B. توکن بلند
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

    // C. پروفایل
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
    const igUserId = profile.user_id || profile.id;

    // D. ذخیره در دیتابیس
    await IGConnections.findOneAndUpdate(
      { ig_userId: igUserId },
      {
        user_id: systemUserId,
        ig_userId: igUserId,
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

    // E. فعال‌سازی وب‌هوک
    try {
      await axios.post(
        `https://graph.instagram.com/v22.0/${igUserId}/subscribed_apps`,
        {
          subscribed_fields: 'messages,comments',
        },
        {
          params: { access_token: longToken },
        }
      );
      console.log(`✅ Webhook Subscribed for @${profile.username}`);
    } catch (subErr) {
      console.error(
        '❌ Webhook Subscription Failed:',
        subErr.response?.data || subErr.message
      );
    }

    // *** ریدایرکت نهایی به دامنه‌ای که کاربر از آن آمده بود ***
    res.redirect(`${targetFrontend}/accounts?status=success`);
  } catch (error) {
    console.error('Connect Error:', error.response?.data || error.message);
    res.redirect(
      `${targetFrontend}/accounts?status=failed&msg=${encodeURIComponent(
        error.message
      )}`
    );
  }
});

router.post('/google', googleLogin);

module.exports = router;
