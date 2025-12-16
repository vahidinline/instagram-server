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
    const url = `https://graph.instagram.com/v22.0/${user.ig_userId}/subscribed_apps`;

    console.log(`🔄 Resetting for: ${user.username}`);

    try {
      // 1. اول حذف کن
      await axios.delete(url, { params: { access_token: user.access_token } });
      console.log('🗑️ Unsubscribed successfully.');

      // 2. دوباره اضافه کن
      const res = await axios.post(
        url,
        { subscribed_fields: 'messages,comments' },
        {
          params: { access_token: user.access_token },
        }
      );
      console.log('✅ Re-subscribed:', res.data);
    } catch (e) {
      console.error('Error:', e.response?.data || e.message);
    }
    process.exit();
  });
