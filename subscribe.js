const axios = require('axios');
const mongoose = require('mongoose');
const IGConnections = require('./models/IG-Connections'); // چک کن نام فایل دقیق باشه
require('dotenv').config();

// اتصال به دیتابیس
mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`
  )
  .then(async () => {
    console.log('🔌 Connected to DB. Fetching User...');

    // 1. دریافت آخرین اکانت لاگین شده
    const user = await IGConnections.findOne().sort({ created_at: -1 });

    if (!user) {
      console.error('❌ No user found in DB. Please Login first!');
      process.exit(1);
    }

    console.log(`👤 User Found: ${user.username} (${user.ig_userId})`);
    console.log('🔑 Token:', user.access_token.substring(0, 15) + '...');

    // 2. ارسال درخواست فعال‌سازی سابسکرایبشن
    try {
      const url = `https://graph.instagram.com/v22.0/${user.ig_userId}/subscribed_apps`;

      const response = await axios.post(
        url,
        {
          subscribed_fields: 'messages,comments,standby', // <--- standby اضافه شد
        },
        {
          params: { access_token: user.access_token },
        }
      );

      console.log('✅✅✅ SUCCESS!');
      console.log('Instagram API Response:', response.data);
      console.log('🎉 Webhooks are now FORCED active for this user.');
    } catch (error) {
      console.error(
        '❌ Error subscribing app:',
        error.response ? error.response.data : error.message
      );
    }

    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
