const express = require('express');
const router = express.Router();
const axios = require('axios');
const MessageLog = require('../models/MessageLogs');
const IGConnections = require('../models/IG-Connections');
const Customer = require('../models/Customer');
// نسخه API
const GRAPH_URL = 'https://graph.instagram.com/v22.0';

// 1. دریافت لیست گفتگوها (Conversations List)
router.get('/conversations', async (req, res) => {
  try {
    const { ig_accountId } = req.query;
    if (!ig_accountId)
      return res.status(400).json({ error: 'Missing ig_accountId' });

    const conversations = await MessageLog.aggregate([
      { $match: { ig_accountId: ig_accountId } },
      { $sort: { created_at: -1 } },
      {
        $group: {
          _id: '$sender_id',
          sender_username: { $first: '$sender_username' },
          sender_avatar: { $first: '$sender_avatar' },
          lastMessage: { $first: '$content' },
          timestamp: { $first: '$created_at' },
          count: { $sum: 1 },
        },
      },
      { $sort: { timestamp: -1 } },
    ]);

    res.json(conversations);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// 2. دریافت تاریخچه پیام‌های یک کاربر
router.get('/messages/:senderId', async (req, res) => {
  try {
    const { ig_accountId } = req.query;
    const { senderId } = req.params;

    const messages = await MessageLog.find({
      ig_accountId,
      sender_id: senderId,
    }).sort({ created_at: 1 });

    res.json(messages);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. ارسال پیام دستی (Manual Reply) - جدید 🚀
router.post('/send', async (req, res) => {
  try {
    const { ig_accountId, recipient_id, message } = req.body;

    if (!ig_accountId || !recipient_id || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // الف) دریافت توکن پیج
    const connection = await IGConnections.findOne({ ig_userId: ig_accountId });
    if (!connection)
      return res.status(404).json({ error: 'Account not found' });

    // ب) ارسال به API اینستاگرام
    await axios.post(
      `${GRAPH_URL}/me/messages`,
      {
        recipient: { id: recipient_id },
        message: { text: message },
      },
      {
        params: { access_token: connection.access_token },
      }
    );

    // ج) ذخیره در دیتابیس (Log)
    // برای اینکه عکس و اسم ادمین هم ثبت بشه، میتونیم از اطلاعات کانکشن استفاده کنیم
    // یا فعلا خالی بذاریم چون پیام خروجی است
    const replyLog = await MessageLog.create({
      ig_accountId,
      sender_id: recipient_id, // طرف مقابل
      sender_username: connection.username, // نام اکانت خودمان
      sender_avatar: connection.profile_picture_url,
      content: message,
      direction: 'outgoing',
      status: 'replied',
    });

    // د) ارسال به سوکت (برای اینکه در فرانت‌‌اند همون لحظه دیده بشه)
    if (global.io) {
      global.io.to(ig_accountId).emit('new_message', replyLog);
    }

    res.json({ success: true, data: replyLog });
  } catch (e) {
    console.error('Manual Send Error:', e.response?.data || e.message);
    res.status(500).json({ error: 'Failed to send message via Instagram API' });
  }
});

// 4. دریافت پروفایل CRM مشتری
router.get('/customer/:senderId', async (req, res) => {
  try {
    const { ig_accountId } = req.query;
    const { senderId } = req.params;

    const customer = await Customer.findOne({
      ig_accountId,
      sender_id: senderId,
    });

    if (!customer) {
      return res.json({
        sentimentLabel: 'neutral',
        tags: [],
        leadScore: 0,
        interactionCount: 0,
      });
    }

    res.json(customer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
