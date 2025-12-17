const axios = require('axios');
const IGConnections = require('../models/IG-Connections');
const Triggers = require('../models/Triggers');
const Flows = require('../models/Flows');
const MessageLog = require('../models/MessageLogs');

// نسخه پایدار API
const GRAPH_URL = 'https://graph.instagram.com/v22.0';

/**
 * پردازش پیام دایرکت (DM)
 */
async function handleMessage(entry, messaging) {
  // 1. جلوگیری از اکو
  if (messaging.message && messaging.message.is_echo) return;

  const igAccountId = entry.id; // اکانت بیزینس ما
  const senderId = messaging.sender.id; // مشتری
  const text = messaging.message?.text;

  if (!text) return;

  console.log(`📥 New Message from ${senderId}: ${text}`);

  try {
    // 2. دریافت اطلاعات اکانت و تنظیمات
    const connection = await IGConnections.findOne({ ig_userId: igAccountId });
    if (!connection) {
      console.error('❌ Connection not found.');
      return;
    }

    const token = connection.access_token;
    const botConfig = connection.botConfig || {
      isActive: true,
      responseDelay: 0,
    };

    // 3. دریافت اطلاعات کاربر (نام و عکس)
    let userInfo = {
      username: 'Instagram User',
      profile_picture: '',
      name: '',
    };
    if (token) {
      userInfo = await fetchUserProfile(senderId, igAccountId, token);
    }

    // 4. ذخیره پیام ورودی
    const incomingLog = await MessageLog.create({
      ig_accountId: igAccountId,
      sender_id: senderId,
      sender_username: userInfo.name || userInfo.username,
      sender_avatar: userInfo.profile_picture,
      content: text,
      direction: 'incoming',
      status: 'received',
    });

    // ارسال به سوکت
    if (global.io) {
      global.io.to(igAccountId).emit('new_message', incomingLog);
    }

    // 5. بررسی خاموش بودن ربات
    if (botConfig.isActive === false) {
      console.log(`⛔ Bot is OFF.`);
      return;
    }

    // 6. جستجوی تریگر
    const trigger = await findMatchingTrigger(igAccountId, text, 'dm');

    if (trigger && trigger.flow_id) {
      console.log(`💡 Trigger Match: [${trigger.keywords.join(', ')}]`);

      const flow = await Flows.findById(trigger.flow_id);

      if (flow) {
        // اعمال تاخیر
        if (botConfig.responseDelay > 0) {
          console.log(`⏳ Waiting ${botConfig.responseDelay}s...`);
          await new Promise((resolve) =>
            setTimeout(resolve, botConfig.responseDelay * 1000)
          );
        }

        // ارسال پیام‌های فلو (با پشتیبانی از دکمه)
        let sentCount = 0;
        for (const msg of flow.messages) {
          // *** ارسال کل آبجکت msg (شامل buttons) به تابع ارسال ***
          const sent = await sendReply(igAccountId, senderId, msg, token);

          if (sent) {
            sentCount++;
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

        // آپدیت شمارنده فلو
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
    console.error('❌ Error in handleMessage:', error.message);
  }
}

/**
 * دریافت پروفایل کاربر (دو مرحله‌ای)
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
 * جستجوی تریگر در آرایه کلمات
 */
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

/**
 * ارسال پیام (با پشتیبانی از دکمه) 🚀
 */
async function sendReply(myId, recipientId, messageData, token) {
  try {
    let payload = {};

    // اگر دکمه دارد (Button Template)
    if (messageData.buttons && messageData.buttons.length > 0) {
      payload = {
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'button',
              text: messageData.content, // متن اصلی
              buttons: messageData.buttons.map((btn) => ({
                type: 'web_url', // فعلا فقط لینک وب
                url: btn.url,
                title: btn.title,
              })),
            },
          },
        },
      };
    }
    // اگر فقط متن است (Simple Text)
    else {
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

/**
 * پردازش کامنت (با چسباندن لینک‌ها به متن) 💬
 */
async function handleComment(entry, change) {
  const igAccountId = entry.id;
  const comment = change.value;
  const text = comment.text;
  const commentId = comment.id;

  if (!text) return;
  console.log(`💬 Comment: ${text}`);

  const trigger = await findMatchingTrigger(igAccountId, text, 'comment');

  if (trigger && trigger.flow_id) {
    console.log(`💡 Trigger Match (Comment): [${trigger.keywords.join(', ')}]`);

    const flow = await Flows.findById(trigger.flow_id);
    if (flow) {
      const token = await getAccessToken(igAccountId);
      if (token) {
        for (const msg of flow.messages) {
          try {
            // چون کامنت دکمه ندارد، لینک‌ها را به متن می‌چسبانیم
            let finalContent = msg.content;
            if (msg.buttons && msg.buttons.length > 0) {
              finalContent +=
                '\n\n🔗 لینک‌های مرتبط:\n' +
                msg.buttons.map((b) => `${b.title}: ${b.url}`).join('\n');
            }

            await axios.post(
              `${GRAPH_URL}/${commentId}/replies`,
              {
                message: finalContent,
              },
              { params: { access_token: token } }
            );
            console.log('✅ Comment Replied.');
          } catch (e) {
            console.error('❌ Comment Reply Error', e.message);
          }
        }
      }
    }
  }
}

module.exports = { handleMessage, handleComment };
