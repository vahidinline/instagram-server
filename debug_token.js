const axios = require('axios');
const mongoose = require('mongoose');
const IGConnections = require('./models/IG-Connections');
require('dotenv').config();

mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`
  )
  .then(async () => {
    const user = await IGConnections.findOne().sort({ created_at: -1 });
    if (!user) {
      console.log('User not found');
      process.exit();
    }

    console.log(`Checking permissions for: ${user.username}`);

    try {
      // درخواست لیست پرمیشن‌ها از متا
      const url = `https://graph.instagram.com/v22.0/me/permissions`;
      const res = await axios.get(url, {
        params: { access_token: user.access_token },
      });

      console.log('--- PERMISSIONS ---');
      console.table(res.data.data); // نمایش جدول پرمیشن‌ها

      const hasMessageScope = res.data.data.some(
        (p) =>
          p.permission === 'instagram_business_manage_messages' &&
          p.status === 'granted'
      );

      if (hasMessageScope) {
        console.log('✅ Message Permission is GRANTED.');
      } else {
        console.log('❌ Message Permission is MISSING!');
      }
    } catch (e) {
      console.error('Error:', e.response ? e.response.data : e.message);
    }
    process.exit();
  });
