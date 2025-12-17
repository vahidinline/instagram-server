const axios = require('axios');
const IGConnections = require('../models/IG-Connections');
const Triggers = require('../models/Triggers');
const Flows = require('../models/Flows');
const MessageLog = require('../models/MessageLogs');
const subManager = require('./subscriptionManager');
const azureService = require('./azureService');

// نسخه پایدار API
const GRAPH_URL = 'https://graph.instagram.com/v22.0';

/**
 * 📨 پردازش پیام دایرکت (DM)
 */
async function handleMessage(entry, messaging) {
  // 1. جلوگیری از لوپ (پیام‌های اکو)
  if (messaging.message && messaging.message.is_echo) return;

  // تغییر نام متغیر به ownerId برای جلوگیری از تداخل با فیلدهای دیتابیس
  const ownerId = entry.id; // اکانت بیزینس ما
  const senderId = messaging.sender.id; // مشتری
  const text = messaging.message?.text;

  if (!text) return;

  console.log(`📥 New Message from ${senderId}: ${text}`);

  // 2. بررسی اشتراک و محدودیت (Gatekeeper)
  const quotaCheck = await subManager.checkLimit(ownerId);
  if (!quotaCheck.allowed) {
    console.log(`⛔ Message Blocked: ${quotaCheck.reason}`);
    return;
  }

  try {
    // 3. دریافت اطلاعات اکانت و تنظیمات
    const connection = await IGConnections.findOne({ ig_userId: ownerId });
    if (!connection) {
      console.error('❌ Connection not found in DB.');
      return;
    }

    const token = connection.access_token;
    const botConfig = connection.botConfig || {
      isActive: true,
      responseDelay: 0,
    };
    const aiConfig = connection.aiConfig || { enabled: false };

    // 4. دریافت پروفایل کاربر (نام و عکس)
    let userInfo = {
      username: 'Instagram User',
      profile_picture: '',
      name: '',
    };
    if (token) {
      userInfo = await fetchUserProfile(senderId, ownerId, token);
    }

    // 5. ذخیره پیام ورودی در دیتابیس
    const incomingLog = await MessageLog.create({
      ig_accountId: ownerId,
      sender_id: senderId,
      sender_username: userInfo.name || userInfo.username,
      sender_avatar: userInfo.profile_picture,
      content: text,
      direction: 'incoming',
      status: 'received',
    });

    // ارسال به سوکت (Live Inbox)
    if (global.io) {
      global.io.to(ownerId).emit('new_message', incomingLog);
    }

    // 6. بررسی سوییچ خاموش/روشن ربات
    if (botConfig.isActive === false) return;

    // 7. جستجوی تریگر
    const trigger = await findMatchingTrigger(ownerId, text, 'dm');

    if (trigger && trigger.flow_id) {
      console.log(`💡 Trigger Match: [${trigger.keywords.join(', ')}]`);
      const flow = await Flows.findById(trigger.flow_id);

      if (flow) {
        // اعمال تاخیر
        if (botConfig.responseDelay > 0) {
          await new Promise((r) =>
            setTimeout(r, botConfig.responseDelay * 1000)
          );
        }

        // ارسال پیام‌های فلو
        for (const msg of flow.messages) {
          const sent = await sendReply(ownerId, senderId, msg, token);

          if (sent) {
            // کسر اعتبار
            await subManager.incrementUsage(quotaCheck.subscription._id);

            // لاگ خروجی
            const replyLog = await MessageLog.create({
              ig_accountId: ownerId,
              sender_id: senderId,
              sender_username: userInfo.name || userInfo.username,
              sender_avatar: userInfo.profile_picture,
              content: msg.content,
              direction: 'outgoing',
              status: 'replied',
              triggered_by: trigger._id,
            });

            // ارسال پاسخ به سوکت
            if (global.io) global.io.to(ownerId).emit('new_message', replyLog);
          }
        }
        // افزایش آمار استفاده از فلو
        await Flows.findByIdAndUpdate(trigger.flow_id, {
          $inc: { usage_count: 1 },
        });

        incomingLog.status = 'processed';
        await incomingLog.save();
      }
    }
    // 8. هوش مصنوعی (اگر تریگر نبود)
    else if (aiConfig.enabled) {
      console.log('🤖 Asking AI...');
      // استفاده صحیح از ownerId
      const aiResponse = await azureService.askAI(
        ownerId,
        text,
        aiConfig.systemPrompt || 'You are a helpful assistant.'
      );

      if (aiResponse) {
        const sent = await sendReply(
          ownerId,
          senderId,
          { content: aiResponse },
          token
        );
        if (sent) {
          await subManager.incrementUsage(quotaCheck.subscription._id);

          const replyLog = await MessageLog.create({
            ig_accountId: ownerId,
            sender_id: senderId,
            sender_username: userInfo.name || userInfo.username,
            sender_avatar: userInfo.profile_picture,
            content: aiResponse,
            direction: 'outgoing',
            status: 'replied_ai',
          });

          if (global.io) global.io.to(ownerId).emit('new_message', replyLog);

          incomingLog.status = 'processed_ai';
          await incomingLog.save();
        }
      }
    } else {
      console.log('🤖 AI is disabled. No reply sent.');
    }
  } catch (error) {
    console.error('❌ Error in handleMessage:', error.message);
  }
}

/**
 * 💬 پردازش کامنت
 */
async function handleComment(entry, change) {
  const ownerId = entry.id; // تغییر نام به ownerId برای هماهنگی
  const comment = change.value;
  const text = comment.text;
  const commentId = comment.id;
  const senderId = comment.from?.id;
  const senderUsername = comment.from?.username;

  if (!text || !senderId) return;

  // دریافت کانکشن برای تنظیمات
  const connection = await IGConnections.findOne({ ig_userId: ownerId });
  if (!connection) return;

  // اگر کامنت خودِ پیج بود، نادیده بگیر
  if (senderUsername === connection.username) return;

  console.log(`💬 Comment from @${senderUsername}: ${text}`);

  // بررسی اشتراک
  const quotaCheck = await subManager.checkLimit(ownerId);
  if (!quotaCheck.allowed) return;

  const token = connection.access_token;
  const botConfig = connection.botConfig || {};

  // جستجوی تریگر برای کامنت
  const trigger = await findMatchingTrigger(ownerId, text, 'comment');

  if (trigger && trigger.flow_id) {
    const flow = await Flows.findById(trigger.flow_id);

    if (flow) {
      // الف) ریپلای عمومی (Public Reply)
      if (botConfig.publicReplyText) {
        try {
          await axios.post(
            `${GRAPH_URL}/${commentId}/replies`,
            {
              message: botConfig.publicReplyText,
            },
            { params: { access_token: token } }
          );
        } catch (e) {
          console.error('Public Reply Error');
        }
      }

      // ب) آماده‌سازی متن دایرکت (Private Reply)
      let messageToSend = flow.messages[0].content;

      // اعمال تنظیم "چک کردن فالو"
      if (botConfig.checkFollow) {
        messageToSend = `${
          botConfig.followWarning || 'لطفا پیج را فالو کنید'
        }\n\n👇👇👇\n${messageToSend}`;
      }

      // اضافه کردن لینک دکمه‌ها
      if (flow.messages[0].buttons && flow.messages[0].buttons.length > 0) {
        messageToSend +=
          '\n\n🔗 لینک‌ها:\n' +
          flow.messages[0].buttons
            .map((b) => `${b.title}: ${b.url}`)
            .join('\n');
      }

      // ج) ارسال دایرکت خصوصی
      try {
        await axios.post(
          `${GRAPH_URL}/me/messages`,
          {
            recipient: { comment_id: commentId },
            message: { text: messageToSend },
          },
          { params: { access_token: token } }
        );

        console.log('✅ Private Reply Sent.');

        // کسر اعتبار
        await subManager.incrementUsage(quotaCheck.subscription._id);

        // لاگ کردن
        await MessageLog.create({
          ig_accountId: ownerId,
          sender_id: senderId,
          sender_username: senderUsername,
          content: messageToSend,
          direction: 'outgoing',
          status: 'replied_comment',
          triggered_by: trigger._id,
        });
      } catch (e) {
        console.error('❌ Private Reply Error:', e.response?.data || e.message);
      }
    }
  }
}

// --- توابع کمکی ---

async function fetchUserProfile(senderId, myIgId, token) {
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

async function sendReply(myId, recipientId, messageData, token) {
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

module.exports = { handleMessage, handleComment };
