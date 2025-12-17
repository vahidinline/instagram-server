const axios = require('axios');
const mongoose = require('mongoose');
const IGConnections = require('./models/IG-Connections');
require('dotenv').config();

mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`
  )
  .then(async () => {
    console.log('🔌 Connected. Fixing subscriptions...');

    // دریافت همه اکانت‌ها
    const accounts = await IGConnections.find({});

    for (const acc of accounts) {
      console.log(`Processing @${acc.username}...`);
      try {
        const res = await axios.post(
          `https://graph.instagram.com/v22.0/${acc.ig_userId}/subscribed_apps`,
          {
            subscribed_fields: 'messages,comments',
          },
          {
            params: { access_token: acc.access_token },
          }
        );
        console.log(`✅ Subscribed:`, res.data);
      } catch (e) {
        console.error(
          `❌ Failed for @${acc.username}:`,
          e.response?.data || e.message
        );
      }
    }

    console.log('Done.');
    process.exit();
  });
