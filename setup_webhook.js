const axios = require('axios');
const mongoose = require('mongoose');
const IGConnections = require('./models/IG-Connections');
require('dotenv').config();

// آدرس تونل ngrok خود را اینجا بگذارید
const MY_CALLBACK_URL = process.env.INSTAGRAM_REDIRECT_URI.replace(
  '/auth/callback',
  '/instagram'
);
const MY_VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;

mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`
  )
  .then(async () => {
    const user = await IGConnections.findOne().sort({ created_at: -1 });

    // استفاده از نسخه v22.0 که مطمئنیم کار میکند
    const BASE_URL = `https://graph.instagram.com/v22.0/${user.ig_userId}/subscribed_apps`;

    console.log(`🔧 Configuring Webhook for: ${user.username}`);

    try {
      // 1. حذف تنظیمات قبلی
      await axios.delete(BASE_URL, {
        params: { access_token: user.access_token },
      });
      console.log('🗑️ Old subscription cleared.');

      // 2. تنظیم مجدد با فیلدهای کامل
      const res = await axios.post(
        BASE_URL,
        {
          subscribed_fields: 'messages,comments,standby',
          // پارامترهای زیر را متا گاهی نیاز دارد تا وب‌هوک را "بیدار" کند
          callback_url: MY_CALLBACK_URL,
          verify_token: MY_VERIFY_TOKEN,
        },
        {
          params: { access_token: user.access_token },
        }
      );

      console.log('✅ Webhook Re-Subscribed via API:', res.data);
      console.log('👉 Now send a message to check ngrok.');
    } catch (e) {
      console.error('❌ Error:', e.response?.data || e.message);
    }
    process.exit();
  });
