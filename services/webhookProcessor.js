const axios = require('axios');
const IGConnections = require('../models/IG-Connections');
const Triggers = require('../models/Triggers');
const Flows = require('../models/Flows');
const MessageLog = require('../models/MessageLogs');
const subManager = require('./subscriptionManager');

// نسخه پایدار API
const GRAPH_URL = 'https://graph.instagram.com/v22.0';

/**
 * پردازش پیام دایرکت (DM)
 */
async function handleMessage(entry, messaging) {
  console.log('🏁 START: handleMessage called');

  // 1. جلوگیری از لوپ
  if (messaging.message && messaging.message.is_echo) {
    return;
  }

  // *** تغییر نام متغیر برای جلوگیری از اشتباه با فیلد دیتابیس ***
  const ownerId = entry.id; // (همان igAccountId)
  const senderId = messaging.sender.id;
  const text = messaging.message?.text;

  if (!text) {
    console.log('⚠️ Skipped: No text');
    return;
  }

  console.log(`📥 New Message from ${senderId} to ${ownerId}: ${text}`);

  // 2. بررسی اشتراک (Gatekeeper)
  console.log('🛡️ Calling Gatekeeper...');
  const quotaCheck = await subManager.checkLimit(ownerId);

  if (!quotaCheck.allowed) {
    console.log(`⛔ Message Blocked: ${quotaCheck.reason}`);
    return;
  }
  console.log('✅ Gatekeeper passed.');

  try {
    // 3. دریافت اطلاعات اکانت
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

    // 4. دریافت پروفایل کاربر
    let userInfo = {
      username: 'Instagram User',
      profile_picture: '',
      name: '',
    };
    if (token) {
      userInfo = await fetchUserProfile(senderId, ownerId, token);
    }

    // 5. ذخیره پیام ورودی
    const incomingLog = await MessageLog.create({
      ig_accountId: ownerId, // استفاده از ownerId
      sender_id: senderId,
      sender_username: userInfo.name || userInfo.username,
      sender_avatar: userInfo.profile_picture,
      content: text,
      direction: 'incoming',
      status: 'received',
    });

    // ارسال به سوکت
    if (global.io) {
      global.io.to(ownerId).emit('new_message', incomingLog);
    }

    // 6. بررسی وضعیت ربات
    if (botConfig.isActive === false) {
      console.log(`⛔ Bot is OFF.`);
      return;
    }

    // 7. جستجوی تریگر
    const trigger = await findMatchingTrigger(ownerId, text, 'dm');

    if (trigger && trigger.flow_id) {
      console.log(`💡 Trigger Match: [${trigger.keywords.join(', ')}]`);

      const flow = await Flows.findById(trigger.flow_id);

      if (flow) {
        // تاخیر
        if (botConfig.responseDelay > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, botConfig.responseDelay * 1000)
          );
        }

        // ارسال پیام‌ها
        let sentCount = 0;
        for (const msg of flow.messages) {
          const sent = await sendReply(ownerId, senderId, msg, token);

          if (sent) {
            sentCount++;

            // کسر اعتبار
            if (quotaCheck.subscription) {
              await subManager.incrementUsage(quotaCheck.subscription._id);
            }

            // ذخیره پیام خروجی
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

            if (global.io) {
              global.io.to(ownerId).emit('new_message', replyLog);
            }
          }
        }

        // آپدیت آمار مصرف فلو
        if (sentCount > 0) {
          await Flows.findByIdAndUpdate(trigger.flow_id, {
            $inc: { usage_count: 1 },
          });
        }

        incomingLog.status = 'processed';
        await incomingLog.save();
      }
    } else {
      console.log('🤖 No trigger found.');
    }
  } catch (error) {
    console.error('❌ Error inside handleMessage:', error.message);
    // چاپ خطای کامل برای دیباگ
    console.error(error);
  }
}

/**
 * دریافت پروفایل
 */
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

/**
 * جستجوی تریگر
 */
async function findMatchingTrigger(igAccountId, text, type) {
  if (!text) return null;

  const triggers = await Triggers.find({
    ig_accountId: igAccountId,
    is_active: true,
    type: { $in: [type, 'both'] },
  });

  const lowerText = text.toLowerCase().trim();

  for (const trigger of triggers) {
    if (!trigger.keywords) continue;
    for (const keyword of trigger.keywords) {
      const k = keyword.toLowerCase().trim();
      if (trigger.match_type === 'exact') {
        if (lowerText === k) return trigger;
      } else if (trigger.match_type === 'contains') {
        if (lowerText.includes(k)) return trigger;
      } else if (trigger.match_type === 'starts_with') {
        if (lowerText.startsWith(k)) return trigger;
      }
    }
  }
  return null;
}

/**
 * ارسال پیام
 */
async function sendReply(myId, recipientId, messageData, token) {
  try {
    let payload = {};
    if (messageData.buttons && messageData.buttons.length > 0) {
      payload = {
        recipient: { id: recipientId },
        message: {
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
        },
      };
    } else {
      payload = {
        recipient: { id: recipientId },
        message: { text: messageData.content },
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
  // لاجیک کامنت
}

module.exports = { handleMessage, handleComment };
