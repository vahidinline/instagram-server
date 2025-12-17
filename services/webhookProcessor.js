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
  // 1. جلوگیری از لوپ
  if (messaging.message && messaging.message.is_echo) return;

  // *** تغییر نام متغیر به accountId برای جلوگیری از هرگونه تداخل ***
  const accountId = entry.id;
  const senderId = messaging.sender.id;
  const text = messaging.message?.text;

  if (!text) return;

  console.log(`[Step 1] New Message from ${senderId}: ${text}`);

  // 2. بررسی اشتراک
  const quotaCheck = await subManager.checkLimit(accountId);
  if (!quotaCheck.allowed) {
    console.log(`⛔ Message Blocked: ${quotaCheck.reason}`);
    return;
  }
  console.log('[Step 2] Gatekeeper passed');

  try {
    // 3. دریافت اطلاعات اکانت
    const connection = await IGConnections.findOne({ ig_userId: accountId });
    if (!connection) {
      console.error('❌ Connection not found in DB.');
      return;
    }
    console.log('[Step 3] Connection found');

    const token = connection.access_token;
    const botConfig = connection.botConfig || {
      isActive: true,
      responseDelay: 0,
    };
    const aiConfig = connection.aiConfig || { enabled: false };

    // 4. دریافت پروفایل کاربر
    let userInfo = {
      username: 'Instagram User',
      profile_picture: '',
      name: '',
    };
    if (token) {
      userInfo = await fetchUserProfile(senderId, accountId, token);
    }
    console.log('[Step 4] Profile fetched');

    // 5. ذخیره پیام ورودی
    const incomingLog = await MessageLog.create({
      ig_accountId: accountId, // اتصال دقیق متغیر جدید
      sender_id: senderId,
      sender_username: userInfo.name || userInfo.username,
      sender_avatar: userInfo.profile_picture,
      content: text,
      direction: 'incoming',
      status: 'received',
    });
    console.log('[Step 5] Incoming log saved');

    if (global.io) {
      global.io.to(accountId).emit('new_message', incomingLog);
    }

    // 6. بررسی وضعیت ربات
    if (botConfig.isActive === false) return;

    // 7. جستجوی تریگر
    const trigger = await findMatchingTrigger(accountId, text, 'dm');
    console.log(
      `[Step 6] Trigger search done. Found: ${trigger ? 'Yes' : 'No'}`
    );

    if (trigger && trigger.flow_id) {
      console.log(`💡 Trigger Match: [${trigger.keywords.join(', ')}]`);
      const flow = await Flows.findById(trigger.flow_id);

      if (flow) {
        if (botConfig.responseDelay > 0) {
          await new Promise((r) =>
            setTimeout(r, botConfig.responseDelay * 1000)
          );
        }

        for (const msg of flow.messages) {
          const sent = await sendReply(accountId, senderId, msg, token);

          if (sent) {
            await subManager.incrementUsage(quotaCheck.subscription._id);

            const replyLog = await MessageLog.create({
              ig_accountId: accountId,
              sender_id: senderId,
              sender_username: userInfo.name || userInfo.username,
              sender_avatar: userInfo.profile_picture,
              content: msg.content,
              direction: 'outgoing',
              status: 'replied',
              triggered_by: trigger._id,
            });

            if (global.io)
              global.io.to(accountId).emit('new_message', replyLog);
          }
        }
        await Flows.findByIdAndUpdate(trigger.flow_id, {
          $inc: { usage_count: 1 },
        });
        incomingLog.status = 'processed';
        await incomingLog.save();
      }
    }
    // 8. هوش مصنوعی (AI)
    else if (aiConfig.enabled) {
      console.log('🤖 Asking AI...');

      // استفاده از accountId
      const aiResponse = await azureService.askAI(
        accountId,
        text,
        aiConfig.systemPrompt || 'You are a helpful assistant.'
      );

      if (aiResponse) {
        const sent = await sendReply(
          accountId,
          senderId,
          { content: aiResponse },
          token
        );

        if (sent) {
          await subManager.incrementUsage(quotaCheck.subscription._id);

          const replyLog = await MessageLog.create({
            ig_accountId: accountId,
            sender_id: senderId,
            sender_username: userInfo.name || userInfo.username,
            sender_avatar: userInfo.profile_picture,
            content: aiResponse,
            direction: 'outgoing',
            status: 'replied_ai',
          });

          if (global.io) global.io.to(accountId).emit('new_message', replyLog);

          incomingLog.status = 'processed_ai';
          await incomingLog.save();
        }
      }
    }
  } catch (error) {
    console.error('❌ Error in handleMessage:', error.message);
    console.error(error.stack); // چاپ استک برای دیدن خط دقیق
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

async function findMatchingTrigger(accountId, text, type) {
  if (!text) return null;
  const triggers = await Triggers.find({
    ig_accountId: accountId,
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

async function handleComment(entry, change) {
  const accountId = entry.id; // تغییر نام
  const comment = change.value;
  const text = comment.text;
  const commentId = comment.id;
  const senderId = comment.from?.id;
  const senderUsername = comment.from?.username;

  if (!text || !senderId) return;

  const connection = await IGConnections.findOne({ ig_userId: accountId });
  if (!connection) return;

  if (senderUsername === connection.username) return;

  console.log(`💬 Comment from @${senderUsername}: ${text}`);

  const quotaCheck = await subManager.checkLimit(accountId);
  if (!quotaCheck.allowed) return;

  const token = connection.access_token;
  const botConfig = connection.botConfig || {};

  const trigger = await findMatchingTrigger(accountId, text, 'comment');

  if (trigger && trigger.flow_id) {
    const flow = await Flows.findById(trigger.flow_id);

    if (flow) {
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

      let messageToSend = flow.messages[0].content;
      if (botConfig.checkFollow) {
        messageToSend = `${
          botConfig.followWarning || 'لطفا پیج را فالو کنید'
        }\n\n👇👇👇\n${messageToSend}`;
      }

      if (flow.messages[0].buttons && flow.messages[0].buttons.length > 0) {
        messageToSend +=
          '\n\n🔗 لینک‌ها:\n' +
          flow.messages[0].buttons
            .map((b) => `${b.title}: ${b.url}`)
            .join('\n');
      }

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
        await subManager.incrementUsage(quotaCheck.subscription._id);

        await MessageLog.create({
          ig_accountId: accountId, // تغییر نام
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

module.exports = { handleMessage, handleComment };
