const axios = require('axios');
const IGConnections = require('../models/IG-Connections');
const Triggers = require('../models/Triggers');
const Flows = require('../models/Flows');
const MessageLog = require('../models/MessageLogs');
const Customer = require('../models/Customer');
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

  const igAccountId = entry.id; // اکانت بیزینس ما
  const senderId = messaging.sender.id; // مشتری
  const text = messaging.message?.text;

  if (!text) return;

  console.log(`📥 New Message from ${senderId}: ${text}`);

  // 2. بررسی اشتراک و محدودیت (Gatekeeper)
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

    // 4. دریافت پروفایل مشتری و استیج فعلی (برای CRM)
    let userInfo = {
      username: 'Instagram User',
      profile_picture: '',
      name: '',
    };

    // جستجو در دیتابیس خودمان برای پیدا کردن مشتری قدیمی
    const existingCustomer = await Customer.findOne({
      ig_accountId: igAccountId,
      sender_id: senderId,
    });
    const currentStage = existingCustomer ? existingCustomer.stage : 'lead'; // پیش‌فرض: سرنخ

    if (existingCustomer && existingCustomer.username) {
      // اگر مشتری قدیمی است، از دیتای موجود استفاده کن (سرعت بالا)
      userInfo = {
        username: existingCustomer.username,
        name: existingCustomer.fullName,
        profile_picture: existingCustomer.profilePic,
      };
    } else if (token) {
      // اگر مشتری جدید است، از اینستاگرام بگیر
      userInfo = await fetchUserProfile(senderId, igAccountId, token);
    }

    // ==================================================
    // 5. تحلیل هوشمند CRM و پایپ‌لاین 📊
    // ==================================================
    let analysis = {
      sentiment: 'neutral',
      tags: [],
      score: 0,
      new_stage: null,
    };

    const hasAiAccess = subManager.checkFeatureAccess(
      quotaCheck.subscription,
      'aiAccess'
    );

    if (hasAiAccess && text.length > 2) {
      try {
        // ارسال استیج فعلی به AI تا تصمیم دقیق‌تر بگیرد
        analysis = await azureService.analyzeMessage(text, currentStage);
        console.log('🧠 CRM Analysis Result:', analysis);
      } catch (e) {
        console.error('CRM Analysis Failed');
      }
    }

    // آماده‌سازی آپدیت دیتابیس مشتری
    let updateQuery = {
      $set: {
        username: userInfo.username,
        fullName: userInfo.name,
        profilePic: userInfo.profile_picture,
        lastInteraction: new Date(),
        sentimentLabel: analysis.sentiment,
      },
      $inc: {
        interactionCount: 1,
        leadScore: analysis.score > 0 ? Math.ceil(analysis.score / 10) : 0,
      },
      $addToSet: { tags: { $each: analysis.tags || [] } },
    };

    // *** لاجیک تغییر مرحله (Stage Change) ***
    if (analysis.new_stage && analysis.new_stage !== currentStage) {
      console.log(`🚀 Pipeline Move: ${currentStage} -> ${analysis.new_stage}`);
      updateQuery.$set.stage = analysis.new_stage;

      // ثبت در تاریخچه
      updateQuery.$push = {
        stageHistory: {
          from: currentStage,
          to: analysis.new_stage,
          date: new Date(),
          reason: `AI Analysis based on message: "${text.substring(0, 15)}..."`,
        },
      };
    }

    // اجرای آپدیت مشتری
    try {
      await Customer.findOneAndUpdate(
        { ig_accountId: igAccountId, sender_id: senderId },
        updateQuery,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (e) {
      console.error('CRM DB Update Error:', e.message);
    }

    // 6. ذخیره پیام ورودی (با برچسب احساسات)
    const incomingLog = await MessageLog.create({
      ig_accountId: igAccountId,
      sender_id: senderId,
      sender_username: userInfo.name || userInfo.username,
      sender_avatar: userInfo.profile_picture,
      content: text,
      direction: 'incoming',
      status: 'received',
      sentiment: analysis.sentiment,
    });

    // ارسال به سوکت (برای نمایش در اینباکس زنده)
    if (global.io) {
      global.io.to(igAccountId).emit('new_message', incomingLog);
    }

    // 7. بررسی وضعیت ربات
    if (botConfig.isActive === false) return;

    // 8. جستجوی تریگر
    const trigger = await findMatchingTrigger(igAccountId, text, 'dm', null);

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
          let tokensUsed = 0;

          // فلوهای ترکیبی (Hybrid AI)
          if (msg.type === 'ai_response') {
            if (!hasAiAccess) continue;
            const hasTokens = await subManager.checkAiLimit(
              quotaCheck.subscription
            );
            if (!hasTokens) continue;

            // تعیین پرامپت
            let systemPrompt =
              aiConfig.activePersonaId?.systemPrompt ||
              aiConfig.systemPrompt ||
              'You are helpful.';
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
              text,
              hybridPrompt,
              senderData,
              aiConfig
            );

            if (!aiResult || !aiResult.content) continue;

            contentToSend = aiResult.content;
            tokensUsed = aiResult.usage?.total_tokens || 0;
            messageType = 'replied_ai';
          }

          // ارسال پیام
          const sent = await sendReply(
            igAccountId,
            senderId,
            { ...msg._doc, content: contentToSend },
            token
          );

          if (sent) {
            if (tokensUsed > 0) {
              await subManager.incrementAiUsage(
                quotaCheck.subscription._id,
                tokensUsed
              );
            } else {
              if (messageType !== 'replied_ai')
                await subManager.incrementUsage(quotaCheck.subscription._id);
            }

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
    // 9. هوش مصنوعی خالص
    else if (aiConfig.enabled) {
      if (!hasAiAccess) return;
      const hasTokens = await subManager.checkAiLimit(quotaCheck.subscription);
      if (!hasTokens) {
        console.log('⛔ AI Token Limit Reached.');
        return;
      }

      console.log('🤖 Asking AI...');

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
        senderData,
        aiConfig
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

  const mediaId = comment.media?.id;

  if (!text || !senderId) return;

  const connection = await IGConnections.findOne({ ig_userId: igAccountId });
  if (!connection) return;

  if (senderUsername === connection.username) return;

  console.log(`💬 Comment from @${senderUsername}: ${text}`);

  const quotaCheck = await subManager.checkLimit(igAccountId);
  if (!quotaCheck.allowed) return;

  const token = connection.access_token;
  const botConfig = connection.botConfig || {};

  const trigger = await findMatchingTrigger(
    igAccountId,
    text,
    'comment',
    mediaId
  );

  if (trigger && trigger.flow_id) {
    const flow = await Flows.findById(trigger.flow_id);

    if (flow) {
      // ریپلای عمومی
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

      // دایرکت خصوصی
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

async function findMatchingTrigger(igAccountId, text, type, mediaId = null) {
  if (!text) return null;
  const allTriggers = await Triggers.find({
    ig_accountId: igAccountId,
    is_active: true,
    type: { $in: [type, 'both'] },
  });
  const lowerText = text.toLowerCase().trim();
  const sortedTriggers = allTriggers.sort((a, b) =>
    a.media_id && !b.media_id ? -1 : !a.media_id && b.media_id ? 1 : 0
  );

  for (const trigger of sortedTriggers) {
    if (!trigger.keywords) continue;
    if (trigger.media_id && trigger.media_id !== mediaId) continue;
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
