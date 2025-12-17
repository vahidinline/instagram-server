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
  // 1. جلوگیری از لوپ (پیام‌هایی که خودمان یا ادمین فرستاده)
  if (messaging.message && messaging.message.is_echo) {
    return;
  }

  const igAccountId = entry.id; // اکانت بیزینس ما
  const senderId = messaging.sender.id; // مشتری
  const text = messaging.message?.text;

  // فعلاً فقط پیام‌های متنی را پردازش می‌کنیم
  if (!text) return;

  console.log(`📥 New Message from ${senderId}: ${text}`);

  // 2. ذخیره پیام ورودی در دیتابیس
  const incomingLog = await MessageLog.create({
    ig_accountId: igAccountId,
    sender_id: senderId,
    content: text,
    direction: 'incoming',
    status: 'received',
  });

  // *** SOCKET: ارسال پیام ورودی به فرانت‌‌اند (برای Live Inbox) ***
  if (global.io) {
    global.io.to(igAccountId).emit('new_message', incomingLog);
  }

  // 3. جستجوی تریگر
  const trigger = await findMatchingTrigger(igAccountId, text, 'dm');

  if (trigger) {
    console.log(`💡 Trigger Match: [${trigger.keywords.join(', ')}]`);

    // اگر تریگر به یک Flow وصل بود
    if (trigger.flow_id) {
      const flow = await Flows.findById(trigger.flow_id);

      if (flow) {
        const token = await getAccessToken(igAccountId);

        if (token) {
          // ارسال تمام پیام‌های موجود در Flow
          for (const msg of flow.messages) {
            const sent = await sendReply(
              igAccountId,
              senderId,
              msg.content,
              token
            );

            // 4. ذخیره پیام خروجی (پاسخ ربات)
            if (sent) {
              const replyLog = await MessageLog.create({
                ig_accountId: igAccountId,
                sender_id: senderId,
                content: msg.content,
                direction: 'outgoing',
                status: 'replied',
                triggered_by: trigger._id,
              });

              // *** SOCKET: ارسال پاسخ ربات به فرانت‌‌اند ***
              if (global.io) {
                global.io.to(igAccountId).emit('new_message', replyLog);
              }
            }
          }

          // آپدیت وضعیت پیام ورودی به "پردازش شده"
          incomingLog.status = 'processed';
          await incomingLog.save();
        } else {
          console.error('❌ No Access Token found for response.');
        }
      } else {
        console.error('❌ Flow not found for this trigger.');
      }
    } else {
      console.error('❌ Trigger has no Flow ID attached.');
    }
  } else {
    console.log('🤖 No trigger found. (Ignored or ready for AI)');
    // اینجا در آینده کد اتصال به هوش مصنوعی قرار می‌گیرد
  }
}

/**
 * جستجوی هوشمند تریگر در بین کلمات کلیدی مختلف
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
    if (!trigger.keywords || trigger.keywords.length === 0) continue;

    for (const keyword of trigger.keywords) {
      // حالت ۱: تطابق دقیق
      if (trigger.match_type === 'exact') {
        if (lowerText === keyword) return trigger;
      }
      // حالت ۲: شامل بودن
      else if (trigger.match_type === 'contains') {
        if (lowerText.includes(keyword)) return trigger;
      }
      // حالت ۳: شروع با (اختیاری)
      else if (trigger.match_type === 'starts_with') {
        if (lowerText.startsWith(keyword)) return trigger;
      }
    }
  }

  return null;
}

/**
 * دریافت توکن دسترسی از دیتابیس
 */
async function getAccessToken(igAccountId) {
  const conn = await IGConnections.findOne({ ig_userId: igAccountId });
  return conn ? conn.access_token : null;
}

/**
 * ارسال پیام به API اینستاگرام
 */
async function sendReply(myId, recipientId, text, token) {
  try {
    await axios.post(
      `${GRAPH_URL}/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text: text },
      },
      { params: { access_token: token } }
    );

    console.log('✅ Reply Sent.');
    return true;
  } catch (e) {
    console.error('❌ Send Error:', e.response?.data || e.message);
    return false;
  }
}

/**
 * پردازش کامنت (می‌توانید بعداً لاگیک فلو را اینجا هم اضافه کنید)
 */
async function handleComment(entry, change) {
  console.log('💬 Comment received (Ready for logic implementation)');
  // اینجا هم می‌توانید مثل دایرکت، تریگرها را چک کنید و پاسخ دهید
}

module.exports = { handleMessage, handleComment };
