const axios = require('axios');
const IGConnections = require('../models/IG-Connections');
const Triggers = require('../models/Triggers');
const Flows = require('../models/Flows');
const MessageLog = require('../models/MessageLogs');
const Persona = require('../models/Persona');
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

  const igAccountId = entry.id; // اکانت بیزینس ما
  const senderId = messaging.sender.id; // مشتری
  const text = messaging.message?.text;

  if (!text) return;

  console.log(`📥 New Message from ${senderId}: ${text}`);

  // 2. بررسی اشتراک و محدودیت
  const quotaCheck = await subManager.checkLimit(igAccountId);
  if (!quotaCheck.allowed) {
    console.log(`⛔ Message Blocked: ${quotaCheck.reason}`);
    return;
  }

  try {
    // 3. دریافت اطلاعات اکانت
    const connection = await IGConnections.findOne({
      ig_userId: igAccountId,
    }).populate('aiConfig.activePersonaId');

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

    // تعیین پرامپت (از پرسونا یا پیش‌فرض)
    let systemPrompt = 'You are a helpful assistant.';
    if (aiConfig.activePersonaId) {
      systemPrompt = aiConfig.activePersonaId.systemPrompt;
    } else if (aiConfig.systemPrompt) {
      systemPrompt = aiConfig.systemPrompt;
    }

    // 4. دریافت پروفایل کاربر (نام و عکس)
    let userInfo = {
      username: 'Instagram User',
      profile_picture: '',
      name: '',
    };
    if (token) {
      userInfo = await fetchUserProfile(senderId, igAccountId, token);
    }

    // 5. ذخیره پیام ورودی
    const incomingLog = await MessageLog.create({
      ig_accountId: igAccountId,
      sender_id: senderId,
      sender_username: userInfo.name || userInfo.username,
      sender_avatar: userInfo.profile_picture,
      content: text,
      direction: 'incoming',
      status: 'received',
    });

    if (global.io) {
      global.io.to(igAccountId).emit('new_message', incomingLog);
    }

    // 6. بررسی وضعیت ربات
    if (botConfig.isActive === false) return;

    // 7. جستجوی تریگر
    const trigger = await findMatchingTrigger(igAccountId, text, 'dm');

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
          let contentToSend = msg.content;
          let messageType = 'replied';

          // *** فلوهای ترکیبی (Hybrid AI) ***
          if (msg.type === 'ai_response') {
            console.log('🤖 Hybrid Flow: Generating AI response...');

            const hasTokens = await subManager.checkAiLimit(
              quotaCheck.subscription
            );
            if (!hasTokens) continue;

            const hybridPrompt = msg.content
              ? `${systemPrompt}\n\nTask: ${msg.content}`
              : systemPrompt;

            // ارسال دیتای کاربر برای لید جنریشن
            const senderData = {
              id: senderId,
              username: userInfo.username,
              fullname: userInfo.name,
            };

            const aiResult = await azureService.askAI(
              igAccountId,
              text,
              hybridPrompt,
              senderData
            );

            if (!aiResult || !aiResult.content) continue;

            contentToSend = aiResult.content;
            // کسر توکن
            const tokensUsed = aiResult.usage?.total_tokens || 0;
            if (tokensUsed > 0) {
              await subManager.incrementAiUsage(
                quotaCheck.subscription._id,
                tokensUsed
              );
            }
            messageType = 'replied_ai';
          }

          // ارسال پیام نهایی
          const sent = await sendReply(
            igAccountId,
            senderId,
            { ...msg._doc, content: contentToSend },
            token
          );

          if (sent) {
            // کسر اعتبار پیام (فقط اگر AI نبود، چون AI بالا کسر شد - یا هر دو بسته به سیاست)
            // در اینجا فرض میکنیم پیام جدا کسر میشود
            await subManager.incrementUsage(quotaCheck.subscription._id);

            const replyLog = await MessageLog.create({
              ig_accountId: igAccountId,
              sender_id: senderId,
              sender_username: userInfo.name || userInfo.username,
              sender_avatar: userInfo.profile_picture,
              content: contentToSend,
              direction: 'outgoing',
              status: messageType,
              triggered_by: trigger._id,
            });

            if (global.io)
              global.io.to(igAccountId).emit('new_message', replyLog);
          }
        }
        await Flows.findByIdAndUpdate(trigger.flow_id, {
          $inc: { usage_count: 1 },
        });
        incomingLog.status = 'processed';
        await incomingLog.save();
      }
    }
    // 8. هوش مصنوعی خالص (اگر تریگر نبود)
    else if (aiConfig.enabled) {
      const hasTokens = await subManager.checkAiLimit(quotaCheck.subscription);
      if (!hasTokens) {
        console.log('⛔ AI Token Limit Reached.');
        return;
      }

      console.log('🤖 Asking AI...');

      // آماده‌سازی دیتای فرستنده برای ثبت لید
      const senderData = {
        id: senderId,
        username: userInfo.username,
        fullname: userInfo.name,
      };

      const aiResult = await azureService.askAI(
        igAccountId,
        text,
        systemPrompt,
        senderData // <--- ارسال دیتای کاربر
      );

      if (aiResult && aiResult.content) {
        const sent = await sendReply(
          igAccountId,
          senderId,
          { content: aiResult.content },
          token
        );

        if (sent) {
          // کسر توکن + پیام
          const tokensUsed = aiResult.usage?.total_tokens || 0;
          await subManager.incrementAiUsage(
            quotaCheck.subscription._id,
            tokensUsed
          );

          const replyLog = await MessageLog.create({
            ig_accountId: igAccountId,
            sender_id: senderId,
            sender_username: userInfo.name || userInfo.username,
            sender_avatar: userInfo.profile_picture,
            content: aiResult.content,
            direction: 'outgoing',
            status: 'replied_ai',
          });

          if (global.io)
            global.io.to(igAccountId).emit('new_message', replyLog);

          incomingLog.status = 'processed_ai';
          await incomingLog.save();
        }
      }
    }
  } catch (error) {
    console.error('❌ Error in handleMessage:', error.message);
  }
}

// ... (بقیه توابع کمکی بدون تغییر) ...

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
    ig_accountId: igAccountId,
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
  const igAccountId = entry.id;
  const comment = change.value;
  const text = comment.text;
  const commentId = comment.id;
  const senderId = comment.from?.id;
  const senderUsername = comment.from?.username;

  if (!text || !senderId) return;

  const connection = await IGConnections.findOne({ ig_userId: igAccountId });
  if (!connection) return;

  if (senderUsername === connection.username) return;

  console.log(`💬 Comment from @${senderUsername}: ${text}`);

  const quotaCheck = await subManager.checkLimit(igAccountId);
  if (!quotaCheck.allowed) return;

  const token = connection.access_token;
  const botConfig = connection.botConfig || {};

  const trigger = await findMatchingTrigger(igAccountId, text, 'comment');

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
          ig_accountId: igAccountId,
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
