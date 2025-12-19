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
  if (messaging.message && messaging.message.is_echo) return;

  const igAccountId = entry.id;
  const senderId = messaging.sender.id;
  const text = messaging.message?.text;

  if (!text) return;

  console.log(`📥 DM Received from ${senderId}: ${text}`);

  const quotaCheck = await subManager.checkLimit(igAccountId);
  if (!quotaCheck.allowed) {
    console.log(`⛔ Blocked by Gatekeeper: ${quotaCheck.reason}`);
    return;
  }

  try {
    const connection = await IGConnections.findOne({
      ig_userId: igAccountId,
    }).populate('aiConfig.activePersonaId');
    if (!connection) return;

    const token = connection.access_token;
    const botConfig = connection.botConfig || {
      isActive: true,
      responseDelay: 0,
    };
    const aiConfig = connection.aiConfig || { enabled: false };

    // پروفایل و لاگ
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

    // جستجوی تریگر (برای دایرکت mediaId نداریم پس null)
    const trigger = await findMatchingTrigger(igAccountId, text, 'dm', null);

    if (trigger && trigger.flow_id) {
      console.log(`💡 Trigger Found: "${trigger.keywords[0]}"`);
      await executeFlow(
        trigger,
        igAccountId,
        senderId,
        token,
        botConfig,
        quotaCheck,
        userInfo,
        text,
        aiConfig
      );
      incomingLog.status = 'processed';
      await incomingLog.save();
    } else if (aiConfig.enabled) {
      await handleAIResponse(
        igAccountId,
        senderId,
        text,
        token,
        aiConfig,
        quotaCheck,
        userInfo,
        incomingLog
      );
    }
  } catch (error) {
    console.error('❌ DM Error:', error.message);
  }
}

/**
 * 💬 پردازش کامنت
 */
async function handleComment(entry, change) {
  const igAccountId = entry.id;
  const comment = change.value;
  const text = comment.text;
  const commentId = comment.id;
  const senderId = comment.from?.id;
  const senderUsername = comment.from?.username;

  // استخراج مدیا آی‌دی
  const mediaId = comment.media?.id;

  if (!text || !senderId) return;

  const connection = await IGConnections.findOne({ ig_userId: igAccountId });
  if (!connection) return;

  if (senderUsername === connection.username) return;

  console.log(`💬 Comment on Post [${mediaId}]: "${text}"`);

  const quotaCheck = await subManager.checkLimit(igAccountId);
  if (!quotaCheck.allowed) return;

  const token = connection.access_token;
  const botConfig = connection.botConfig || {};

  // جستجوی تریگر با شناسه پست
  const trigger = await findMatchingTrigger(
    igAccountId,
    text,
    'comment',
    mediaId
  );

  if (trigger && trigger.flow_id) {
    console.log(
      `💡 Trigger Match for Post ${mediaId}: [${trigger.keywords[0]}]`
    );

    const flow = await Flows.findById(trigger.flow_id);
    if (flow) {
      // 1. ریپلای عمومی
      if (botConfig.publicReplyText) {
        try {
          await axios.post(
            `${GRAPH_URL}/${commentId}/replies`,
            {
              message: botConfig.publicReplyText,
            },
            { params: { access_token: token } }
          );
        } catch (e) {}
      }

      // 2. آماده‌سازی پیام دایرکت
      let messageToSend = flow.messages[0].content;
      if (botConfig.checkFollow) {
        messageToSend = `${
          botConfig.followWarning || 'Follow us!'
        }\n\n👇\n${messageToSend}`;
      }
      if (flow.messages[0].buttons?.length > 0) {
        messageToSend +=
          '\n\n🔗 ' +
          flow.messages[0].buttons
            .map((b) => `${b.title}: ${b.url}`)
            .join('\n');
      }

      // 3. ارسال دایرکت
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
  } else {
    console.log(`⛔ No matching trigger for comment on post ${mediaId}`);
  }
}

// ------------------------------------------------------------------
// توابع کمکی هوشمند (Logic Core)
// ------------------------------------------------------------------

/**
 * جستجوی تریگر (نسخه ضدضربه و دقیق)
 */
async function findMatchingTrigger(igAccountId, text, type, mediaId = null) {
  if (!text) return null;

  // 1. دریافت تمام تریگرهای فعال این اکانت
  // (فیلتر کردن در JS امن‌تر است)
  const allTriggers = await Triggers.find({
    ig_accountId: igAccountId,
    is_active: true,
    type: { $in: [type, 'both'] },
  });

  const lowerText = text.toLowerCase().trim();

  // 2. جداسازی تریگرها
  // الف: تریگرهای اختصاصی این پست (اولویت بالا)
  const specificTriggers = allTriggers.filter(
    (t) => t.media_id && t.media_id === mediaId
  );

  // ب: تریگرهای عمومی (بدون media_id)
  // نکته: اگر مدیا آی‌دی داریم، تریگرهای عمومی هم ممکن است کار کنند (بسته به بیزینس لاجیک)
  // اما تریگری که media_id دارد ولی مال "این پست" نیست را کلا دور میریزیم.
  const globalTriggers = allTriggers.filter((t) => !t.media_id);

  // تابع چک کردن کلمات کلیدی
  const checkKeywords = (trigger) => {
    if (!trigger.keywords) return false;
    for (const k of trigger.keywords) {
      const key = k.toLowerCase().trim();
      if (trigger.match_type === 'exact' && lowerText === key) return true;
      if (trigger.match_type === 'contains' && lowerText.includes(key))
        return true;
      if (trigger.match_type === 'starts_with' && lowerText.startsWith(key))
        return true;
    }
    return false;
  };

  // 3. اولویت اول: چک کردن تریگرهای اختصاصی
  for (const t of specificTriggers) {
    if (checkKeywords(t)) {
      console.log(`🎯 Exact Post Match! (Media: ${mediaId})`);
      return t;
    }
  }

  // 4. اولویت دوم: چک کردن تریگرهای عمومی
  for (const t of globalTriggers) {
    if (checkKeywords(t)) {
      console.log(`🌍 Global Trigger Match (No Media ID)`);
      return t;
    }
  }

  // اگر به اینجا رسیدیم، یعنی هیچ تریگری مچ نشد
  // برای دیباگ: اگر کامنت بود و مچ نشد، لاگ کن چرا
  if (mediaId && allTriggers.length > 0) {
    const wrongPostTriggers = allTriggers.filter(
      (t) => t.media_id && t.media_id !== mediaId
    );
    if (wrongPostTriggers.length > 0) {
      console.log(
        `⚠️ Skipped ${wrongPostTriggers.length} triggers because Media ID did not match ${mediaId}`
      );
    }
  }

  return null;
}

// اجرای فلو (ارسال پیام‌های متوالی + AI)
async function executeFlow(
  trigger,
  igAccountId,
  senderId,
  token,
  botConfig,
  quotaCheck,
  userInfo,
  userText,
  aiConfig
) {
  const flow = await Flows.findById(trigger.flow_id);
  if (!flow) return;

  if (botConfig.responseDelay > 0) {
    await new Promise((r) => setTimeout(r, botConfig.responseDelay * 1000));
  }

  let systemPrompt =
    aiConfig.activePersonaId?.systemPrompt ||
    aiConfig.systemPrompt ||
    'You are helpful.';

  for (const msg of flow.messages) {
    let contentToSend = msg.content;
    let messageType = 'replied';

    if (msg.type === 'ai_response') {
      const hasTokens = await subManager.checkAiLimit(quotaCheck.subscription);
      if (!hasTokens) continue;

      const hybridPrompt = msg.content
        ? `${systemPrompt}\n\nTask: ${msg.content}`
        : systemPrompt;
      const senderData = {
        id: senderId,
        username: userInfo.username,
        fullname: userInfo.name,
      };

      const aiResult = await azureService.askAI(
        igAccountId,
        userText,
        hybridPrompt,
        senderData
      );
      if (!aiResult?.content) continue;

      contentToSend = aiResult.content;
      if (aiResult.usage?.total_tokens) {
        await subManager.incrementAiUsage(
          quotaCheck.subscription._id,
          aiResult.usage.total_tokens
        );
      }
      messageType = 'replied_ai';
    }

    const sent = await sendReply(
      igAccountId,
      senderId,
      { ...msg._doc, content: contentToSend },
      token
    );
    if (sent) {
      if (messageType !== 'replied_ai')
        await subManager.incrementUsage(quotaCheck.subscription._id);

      const log = await MessageLog.create({
        ig_accountId: igAccountId,
        sender_id: senderId,
        sender_username: userInfo.name || userInfo.username,
        sender_avatar: userInfo.profile_picture,
        content: contentToSend,
        direction: 'outgoing',
        status: messageType,
        triggered_by: trigger._id,
      });
      if (global.io) global.io.to(igAccountId).emit('new_message', log);
    }
  }
  await Flows.findByIdAndUpdate(trigger.flow_id, { $inc: { usage_count: 1 } });
}

// هندل کردن پاسخ AI خالص
async function handleAIResponse(
  igAccountId,
  senderId,
  text,
  token,
  aiConfig,
  quotaCheck,
  userInfo,
  incomingLog
) {
  console.log('🤖 Asking AI (No Trigger)...');

  const hasTokens = await subManager.checkAiLimit(quotaCheck.subscription);
  if (!hasTokens) return;

  let systemPrompt =
    aiConfig.activePersonaId?.systemPrompt ||
    aiConfig.systemPrompt ||
    'You are helpful.';
  const senderData = {
    id: senderId,
    username: userInfo.username,
    fullname: userInfo.name,
  };

  const aiResult = await azureService.askAI(
    igAccountId,
    text,
    systemPrompt,
    senderData
  );

  if (aiResult && aiResult.content) {
    const sent = await sendReply(
      igAccountId,
      senderId,
      { content: aiResult.content },
      token
    );
    if (sent) {
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

      if (global.io) global.io.to(igAccountId).emit('new_message', replyLog);

      incomingLog.status = 'processed_ai';
      await incomingLog.save();
    }
  }
}

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

async function sendReply(myId, recipientId, messageData, token) {
  try {
    let payload = {
      recipient: { id: recipientId },
      message: { text: messageData.content },
    };
    if (messageData.buttons?.length > 0) {
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
    return true;
  } catch (e) {
    console.error('❌ Send Error:', e.response?.data || e.message);
    return false;
  }
}

module.exports = { handleMessage, handleComment };
