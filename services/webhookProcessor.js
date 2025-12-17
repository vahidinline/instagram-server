const axios = require('axios');
const IGConnections = require('../models/IG-Connections');
const Triggers = require('../models/Triggers');
const Flows = require('../models/Flows');
const MessageLog = require('../models/MessageLogs');
const subManager = require('./subscriptionManager');
const azureService = require('./azureService'); // <--- ایمپورت سرویس هوش مصنوعی

const GRAPH_URL = 'https://graph.instagram.com/v22.0';

async function handleMessage(entry, messaging) {
  if (messaging.message && messaging.message.is_echo) return;

  const igAccountId = entry.id;
  const senderId = messaging.sender.id;
  const text = messaging.message?.text;

  if (!text) return;

  console.log(`📥 New Message from ${senderId}: ${text}`);

  // 1. بررسی اشتراک
  const quotaCheck = await subManager.checkLimit(igAccountId);
  if (!quotaCheck.allowed) return;

  try {
    // 2. دریافت اطلاعات اکانت
    const connection = await IGConnections.findOne({ ig_userId: igAccountId });
    if (!connection) return;

    const token = connection.access_token;
    const botConfig = connection.botConfig || {
      isActive: true,
      responseDelay: 0,
    };
    const aiConfig = connection.aiConfig || { enabled: false }; // تنظیمات AI

    // 3. پروفایل و لاگ ورودی
    let userInfo = { username: 'User', profile_picture: '', name: '' };
    if (token) userInfo = await fetchUserProfile(senderId, igAccountId, token);

    const incomingLog = await MessageLog.create({
      ig_accountId: igAccountId,
      sender_id: senderId,
      sender_username: userInfo.name || userInfo.username,
      sender_avatar: userInfo.profile_picture,
      content: text,
      direction: 'incoming',
      status: 'received',
    });

    if (global.io) global.io.to(igAccountId).emit('new_message', incomingLog);

    if (botConfig.isActive === false) return;

    // 4. اولویت اول: جستجوی تریگر
    const trigger = await findMatchingTrigger(igAccountId, text, 'dm');

    if (trigger && trigger.flow_id) {
      // ... (کد ارسال فلو مثل قبل) ...
      const flow = await Flows.findById(trigger.flow_id);
      if (flow) {
        if (botConfig.responseDelay > 0)
          await new Promise((r) =>
            setTimeout(r, botConfig.responseDelay * 1000)
          );

        for (const msg of flow.messages) {
          const sent = await sendReply(igAccountId, senderId, msg, token);
          if (sent) {
            await subManager.incrementUsage(quotaCheck.subscription._id);
            // لاگ خروجی و سوکت...
            const replyLog = await MessageLog.create({
              ig_accountId: igAccountId,
              sender_id: senderId,
              sender_username: userInfo.name || userInfo.username,
              sender_avatar: userInfo.profile_picture,
              content: msg.content,
              direction: 'outgoing',
              status: 'replied',
              triggered_by: trigger._id,
            });
            if (global.io)
              global.io.to(igAccountId).emit('new_message', replyLog);
          }
        }
        incomingLog.status = 'processed';
        await incomingLog.save();
      }
    }
    // 5. اولویت دوم: هوش مصنوعی (اگر تریگر نبود و AI روشن بود)
    else if (aiConfig.enabled) {
      console.log('🤖 No trigger found. Asking AI...');

      // نمایش Typing... (اختیاری ولی جذاب)
      // await showTyping(igAccountId, senderId, token);

      const aiResponse = await azureService.askAI(
        igAccountId,
        text,
        aiConfig.systemPrompt // ارسال شخصیت تعریف شده در پنل
      );

      if (aiResponse) {
        const sent = await sendReply(
          igAccountId,
          senderId,
          { content: aiResponse },
          token
        );

        if (sent) {
          await subManager.incrementUsage(quotaCheck.subscription._id);

          const replyLog = await MessageLog.create({
            ig_accountId: igAccountId,
            sender_id: senderId,
            sender_username: userInfo.name || userInfo.username,
            sender_avatar: userInfo.profile_picture,
            content: aiResponse,
            direction: 'outgoing',
            status: 'replied_ai', // وضعیت جدید برای تفکیک
          });

          if (global.io)
            global.io.to(igAccountId).emit('new_message', replyLog);

          incomingLog.status = 'processed_ai';
          await incomingLog.save();
        }
      }
    } else {
      console.log('🤖 AI is disabled. No reply sent.');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// ... (توابع کمکی fetchUserProfile, findMatchingTrigger, getAccessToken, sendReply, handleComment عین قبل) ...
// برای کوتاه شدن کد، آنها را تکرار نکردم چون تغییری نکرده‌اند.
// فقط مطمئن شو require('./azureService') را بالا اضافه کردی.

async function fetchUserProfile(senderId, myIgId, token) {
  /* کد قبلی */
  try {
    const userRes = await axios.get(`${GRAPH_URL}/${senderId}`, {
      params: { fields: 'username,name', access_token: token },
    });
    const { username, name } = userRes.data;
    let profile_picture = '';
    if (username) {
      try {
        const discoveryRes = await axios.get(`${GRAPH_URL}/${myIgId}`, {
          params: {
            fields: `business_discovery.username(${username}){profile_picture_url}`,
            access_token: token,
          },
        });
        profile_picture =
          discoveryRes.data.business_discovery?.profile_picture_url || '';
      } catch (err) {}
    }
    return {
      username: username || 'User',
      name: name || username,
      profile_picture,
    };
  } catch (e) {
    return { username: 'Instagram User', profile_picture: '', name: '' };
  }
}

async function findMatchingTrigger(igAccountId, text, type) {
  /* کد قبلی */
  if (!text) return null;
  const triggers = await Triggers.find({
    ig_accountId,
    is_active: true,
    type: { $in: [type, 'both'] },
  });
  const lowerText = text.toLowerCase().trim();
  for (const trigger of triggers) {
    if (!trigger.keywords) continue;
    for (const keyword of trigger.keywords) {
      const k = keyword.toLowerCase().trim();
      if (trigger.match_type === 'exact' && lowerText === k) return trigger;
      if (trigger.match_type === 'contains' && lowerText.includes(k))
        return trigger;
      if (trigger.match_type === 'starts_with' && lowerText.startsWith(k))
        return trigger;
    }
  }
  return null;
}

async function getAccessToken(id) {
  const c = await IGConnections.findOne({ ig_userId: id });
  return c ? c.access_token : null;
}

async function sendReply(myId, recipientId, messageData, token) {
  /* کد قبلی */
  try {
    let payload = {
      recipient: { id: recipientId },
      message: { text: messageData.content },
    };
    if (messageData.buttons && messageData.buttons.length > 0) {
      payload.message = {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: messageData.content,
            buttons: messageData.buttons.map((btn) => ({
              type: 'web_url',
              url: btn.url,
              title: btn.title,
            })),
          },
        },
      };
    }
    await axios.post(`${GRAPH_URL}/me/messages`, payload, {
      params: { access_token: token },
    });
    console.log('✅ Reply Sent.');
    return true;
  } catch (e) {
    console.error('❌ Send Error:', e.response?.data || e.message);
    return false;
  }
}

async function handleComment(entry, change) {
  /* کد کامنت */
}

module.exports = { handleMessage, handleComment };
