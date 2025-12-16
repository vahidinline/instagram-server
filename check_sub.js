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

    console.log(`Checking subscriptions for: ${user.username}`);

    try {
      // درخواست GET برای دیدن وضعیت اشتراک
      const url = `https://graph.instagram.com/v22.0/me/subscribed_apps`;
      const res = await axios.get(url, {
        params: { access_token: user.access_token },
      });

      console.log('--- SUBSCRIPTION STATUS ---');
      console.log(JSON.stringify(res.data, null, 2));

      if (res.data.data && res.data.data.length > 0) {
        console.log('✅ App IS subscribed to webhooks!');
      } else {
        console.log('❌ App is NOT subscribed. Run subscribe.js again.');
      }
    } catch (e) {
      console.error('Error:', e.response ? e.response.data : e.message);
    }
    process.exit();
  });
