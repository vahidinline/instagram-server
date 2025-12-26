const axios = require('axios');
const IGConnections = require('../models/IG-Connections');
const WebConnection = require('../models/WebConnection'); // <--- مدل وب
const Triggers = require('../models/Triggers');
const Flows = require('../models/Flows');
const MessageLog = require('../models/MessageLogs');
const Customer = require('../models/Customer');
const Campaign = require('../models/Campaign');
const subManager = require('./subscriptionManager');
const azureService = require('./azureService');

// نسخه پایدار API اینستاگرام
const GRAPH_URL = 'https://graph.instagram.com/v22.0';

/**
 * 📨 پردازش پیام (مشترک برای اینستاگرام و وب)
 */
async function handleMessage(entry, messaging) {
  // 1. جلوگیری از لوپ (پیام‌های اکو)
  if (messaging.message && messaging.message.is_echo) return;

  const igAccountId = entry.id; // شناسه کانال
  const senderId = messaging.sender.id; // مشتری
  const text = messaging.message?.text;
  const platform = entry.platform || 'instagram'; // <--- تشخیص پلتفرم

  if (!text) return;

  console.log(`📥 [${platform}] New Message from ${senderId}: ${text}`);

  // 2. بررسی اشتراک و محدودیت (Gatekeeper)
  // *** اصلاح: پاس دادن پلتفرم به نگهبان ***
  const quotaCheck = await subManager.checkLimit(igAccountId, platform);

  if (!quotaCheck.allowed) {
    console.log(`⛔ Message Blocked: ${quotaCheck.reason}`);
    return;
  }

  try {
    // 3. دریافت اطلاعات اکانت و تنظیمات
    let connection, token, botConfig, aiConfig;
    let isWeb = platform === 'web';

    if (isWeb) {
      // --- حالت وب ---
      connection = await WebConnection.findById(igAccountId);
      if (!connection) {
        console.error('❌ Web Connection not found.');
        return;
      }

      token = 'WEB_TOKEN';
      botConfig = connection.botConfig || { isActive: true, responseDelay: 0 };
      // تنظیمات AI برای وب (فعلا دیفالت روشن، یا باید به مدل وب اضافه شود)
      aiConfig = {
        enabled: true,
        systemPrompt: 'You are a helpful shop assistant.',
      };
    } else {
      // --- حالت اینستاگرام ---
      connection = await IGConnections.findOne({
        ig_userId: igAccountId,
      }).populate('aiConfig.activePersonaId');
      if (!connection) {
        console.error('❌ IG Connection not found.');
        return;
      }

      token = connection.access_token;
      botConfig = connection.botConfig || { isActive: true, responseDelay: 0 };
      aiConfig = connection.aiConfig || { enabled: false };
    }

    // تعیین دستورالعمل سیستم
    let systemPrompt = 'You are a helpful assistant.';
    if (!isWeb) {
      // پرسونا فقط برای اینستاگرام فعلا پیاده شده، برای وب دیفالت میذاریم یا توسعه میدیم
      if (aiConfig.activePersonaId)
        systemPrompt = aiConfig.activePersonaId.systemPrompt;
      else if (aiConfig.systemPrompt) systemPrompt = aiConfig.systemPrompt;
    } else {
      // برای وب، اگر پیامی در ویجت کانفیگ بود
      systemPrompt =
        connection.widgetConfig?.welcomeMessage ||
        'You are a helpful assistant.';
    }

    // 4. دریافت پروفایل کاربر
    let userInfo = { username: 'User', profile_picture: '', name: '' };

    const existingCustomer = await Customer.findOne({
      ig_accountId: igAccountId,
      sender_id: senderId,
    });

    if (existingCustomer && existingCustomer.username) {
      userInfo = {
        username: existingCustomer.username,
        name: existingCustomer.fullName,
        profile_picture: existingCustomer.profilePic,
      };
    } else {
      if (isWeb) {
        // در وب نام کاربر مهمان است
        userInfo = {
          username: `Guest_${senderId.substr(0, 5)}`,
          name: 'Guest User',
          profile_picture: '',
        };
      } else if (token) {
        userInfo = await fetchUserProfile(senderId, igAccountId, token);
      }
    }

    // 5. تحلیل CRM (مشترک)
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
    const currentStage = existingCustomer ? existingCustomer.stage : 'lead';

    if (hasAiAccess && text.length > 2) {
      try {
        analysis = await azureService.analyzeMessage(text, currentStage);
      } catch (e) {
        console.error('CRM Analysis Fail');
      }
    }

    // آپدیت پروفایل مشتری
    try {
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

      if (analysis.new_stage && analysis.new_stage !== currentStage) {
        updateQuery.$set.stage = analysis.new_stage;
        updateQuery.$push = {
          stageHistory: {
            from: currentStage,
            to: analysis.new_stage,
            date: new Date(),
            reason: 'AI Analysis',
          },
        };
      }

      await Customer.findOneAndUpdate(
        { ig_accountId: igAccountId, sender_id: senderId },
        updateQuery,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (e) {
      console.error('CRM DB Error:', e.message);
    }

    // 6. ذخیره پیام ورودی
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

    // ارسال به سوکت پنل ادمین (Live Inbox)
    if (global.io) {
      // برای وب هم به همان روم اکانت ارسال میکنیم
      global.io.to(igAccountId).emit('new_message', incomingLog);
    }

    // 7. بررسی وضعیت ربات
    if (botConfig.isActive === false) return;

    // 8. جستجوی تریگر
    // برای وب، مدیا آی‌دی نال است
    const trigger = await findMatchingTrigger(igAccountId, text, 'dm', null);

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

        // اجرای فلو (با پاس دادن پلتفرم)
        await executeFlow(
          trigger,
          igAccountId,
          senderId,
          token,
          botConfig,
          quotaCheck,
          userInfo,
          text,
          aiConfig,
          platform
        );

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

      const senderData = {
        id: senderId,
        username: userInfo.username,
        fullname: userInfo.name,
      };

      // تاریخچه چت
      const history = await getChatHistory(
        igAccountId,
        senderId,
        incomingLog._id
      );

      // لیست فلوها
      const availableFlows = await Flows.find({
        ig_accountId: igAccountId,
      }).select('name');

      // نوع کانال برای ابزارهای فروشگاه
      const channelType = isWeb ? 'web' : 'instagram';

      const aiResult = await azureService.askAI(
        igAccountId,
        text,
        systemPrompt,
        senderData,
        aiConfig,
        history,
        availableFlows,
        channelType // <--- ارسال نوع کانال
      );

      if (aiResult) {
        if (aiResult.usage?.total_tokens) {
          await subManager.incrementAiUsage(
            quotaCheck.subscription._id,
            aiResult.usage.total_tokens
          );
        }

        // حالت الف: AI دستور اجرای فلو داد
        if (aiResult.action === 'trigger_flow') {
          const targetFlow = await Flows.findOne({
            ig_accountId: igAccountId,
            name: aiResult.flowName,
          });
          if (targetFlow) {
            console.log(`🤖 AI Triggered Flow: ${targetFlow.name}`);
            // اجرای فلو (با پاس دادن پلتفرم)
            await executeFlow(
              { flow_id: targetFlow._id },
              igAccountId,
              senderId,
              token,
              botConfig,
              quotaCheck,
              userInfo,
              text,
              aiConfig,
              platform
            );
          }
        }
        // حالت ب: پاسخ متنی
        else if (aiResult.content) {
          const sent = await sendReply(
            igAccountId,
            senderId,
            { content: aiResult.content, type: 'text' },
            token,
            platform // <--- مهم: پاس دادن پلتفرم
          );

          if (sent) {
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
    }
  } catch (error) {
    console.error('❌ Error in handleMessage:', error.message);
  }
}

/**
 * 💬 پردازش کامنت (فقط اینستاگرام)
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
    const campaignCheck = await checkCampaignRules(trigger);
    if (!campaignCheck) return;
    const campaign = campaignCheck.campaign;

    const flow = await Flows.findById(trigger.flow_id);

    if (flow) {
      // الف) ریپلای عمومی
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

      // ب) آماده‌سازی متن دایرکت
      const firstMsg = flow.messages[0];
      let messageToSend = firstMsg.content;

      if (!messageToSend) {
        if (firstMsg.type === 'card')
          messageToSend =
            `👇 لیست پیشنهادات:\n` +
            firstMsg.cards.map((c) => `🔹 ${c.title}`).join('\n');
        else messageToSend = 'پاسخ خودکار';
      }

      if (botConfig.checkFollow) {
        messageToSend = `${
          botConfig.followWarning || 'لطفا پیج را فالو کنید'
        }\n\n👇👇👇\n${messageToSend}`;
      }

      if (firstMsg.buttons && firstMsg.buttons.length > 0) {
        messageToSend +=
          '\n\n🔗 لینک‌ها:\n' +
          firstMsg.buttons.map((b) => `${b.title}: ${b.url}`).join('\n');
      }

      // ج) ارسال دایرکت
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

        if (campaign)
          await Campaign.findByIdAndUpdate(campaign._id, {
            $inc: { 'limits.currentReplies': 1 },
          });

        const replyLog = await MessageLog.create({
          ig_accountId: igAccountId,
          sender_id: senderId,
          sender_username: senderUsername,
          content: messageToSend,
          direction: 'outgoing',
          status: 'replied_comment',
          triggered_by: trigger._id,
        });

        if (global.io) global.io.to(igAccountId).emit('new_message', replyLog);
      } catch (e) {
        console.error('❌ Private Reply Error:', e.response?.data || e.message);
      }
    }
  }
}

// ----------------------------------------------------------------
// توابع کمکی
// ----------------------------------------------------------------

async function checkCampaignRules(trigger) {
  if (!trigger.campaign_id) return { allowed: true, campaign: null };

  const campaign = await Campaign.findById(trigger.campaign_id);
  if (!campaign) return { allowed: true, campaign: null };

  const now = new Date();
  if (campaign.status !== 'active') return false;
  if (
    campaign.schedule.startDate &&
    now < new Date(campaign.schedule.startDate)
  )
    return false;
  if (campaign.schedule.endDate && now > new Date(campaign.schedule.endDate))
    return false;

  if (
    campaign.limits.maxReplies > 0 &&
    campaign.limits.currentReplies >= campaign.limits.maxReplies
  )
    return false;

  return { allowed: true, campaign };
}

// اجرای فلو (چند پلتفرمی)
async function executeFlow(
  trigger,
  igAccountId,
  senderId,
  token,
  botConfig,
  quotaCheck,
  userInfo,
  userText,
  aiConfig,
  platform = 'instagram'
) {
  const flow = await Flows.findById(trigger.flow_id || trigger.flowId);
  if (!flow) return;

  if (botConfig.responseDelay > 0)
    await new Promise((r) => setTimeout(r, botConfig.responseDelay * 1000));

  for (const msg of flow.messages) {
    let contentToSend = msg.content;
    let messageType = 'replied';

    if (msg.type === 'ai_response') {
      const hasAccess = subManager.checkFeatureAccess(
        quotaCheck.subscription,
        'aiAccess'
      );
      if (!hasAccess) continue;

      const hasTokens = await subManager.checkAiLimit(quotaCheck.subscription);
      if (!hasTokens) continue;

      const systemPrompt =
        aiConfig.activePersonaId?.systemPrompt ||
        aiConfig.systemPrompt ||
        'Helpful assistant.';
      const hybridPrompt = msg.content
        ? `${systemPrompt}\n\nTask: ${msg.content}`
        : systemPrompt;
      const senderData = { id: senderId, username: userInfo.username };
      const channelType = platform === 'web' ? 'web' : 'instagram';

      const aiResult = await azureService.askAI(
        igAccountId,
        userText,
        hybridPrompt,
        senderData,
        aiConfig,
        [],
        [],
        channelType
      );

      if (!aiResult?.content) continue;

      contentToSend = aiResult.content;
      if (aiResult.usage?.total_tokens)
        await subManager.incrementAiUsage(
          quotaCheck.subscription._id,
          aiResult.usage.total_tokens
        );
      messageType = 'replied_ai';
    }

    // ارسال با پلتفرم صحیح
    const sent = await sendReply(
      igAccountId,
      senderId,
      { ...msg._doc, content: contentToSend },
      token,
      platform
    );

    if (sent) {
      if (messageType !== 'replied_ai')
        await subManager.incrementUsage(quotaCheck.subscription._id);

      const log = await MessageLog.create({
        ig_accountId: igAccountId,
        sender_id: senderId,
        sender_username: userInfo.name || userInfo.username,
        sender_avatar: userInfo.profile_picture,
        content: contentToSend || `[${msg.type}]`,
        direction: 'outgoing',
        status: messageType,
        triggered_by: trigger._id || null,
      });
      if (global.io) global.io.to(igAccountId).emit('new_message', log);
    }
  }
  // فقط برای تریگر واقعی افزایش بده
  if (trigger._id)
    await Flows.findByIdAndUpdate(flow._id, { $inc: { usage_count: 1 } });
}

async function getChatHistory(igAccountId, senderId, currentMsgId) {
  try {
    const logs = await MessageLog.find({
      ig_accountId,
      sender_id: senderId,
      _id: { $ne: currentMsgId },
    })
      .sort({ created_at: -1 })
      .limit(6);

    return logs.reverse().map((log) => ({
      role: log.direction === 'incoming' ? 'user' : 'assistant',
      content: log.content || '...',
    }));
  } catch (e) {
    return [];
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

// *** تابع ارسال پیام (پشتیبانی از وب + اینستاگرام) ***
async function sendReply(
  accountId,
  recipientId,
  messageData,
  token,
  platform = 'instagram'
) {
  try {
    // --- 1. ارسال به وب (سوکت) ---
    if (platform === 'web') {
      const roomName = `web_${accountId}_${recipientId}`;
      console.log(`📤 Sending to Web Socket: ${roomName}`);

      let socketPayload = {
        direction: 'outgoing',
        content: messageData.content,
        message_type: messageData.type || 'text',
        // اگر کاروسل بود، آرایه کاردها
        products: messageData.type === 'card' ? messageData.cards : null,
        // اگر مدیا بود
        media_url: messageData.media_url,
      };

      // نکته: در وب کاروسل‌ها و دکمه‌ها را به صورت آبجکت می‌فرستیم تا فرانت (widget.js) رندر کند
      if (messageData.buttons) {
        socketPayload.buttons = messageData.buttons;
      }

      if (global.io) {
        global.io.to(roomName).emit('new_message', socketPayload);
        console.log('✅ Web Reply Emitted.');
        return true;
      }
      return false;
    }

    // --- 2. ارسال به اینستاگرام (Graph API) ---
    let payload = { recipient: { id: recipientId }, message: {} };

    switch (messageData.type) {
      case 'text':
      case 'ai_response':
        if (messageData.buttons && messageData.buttons.length > 0) {
          payload.message = {
            attachment: {
              type: 'template',
              payload: {
                template_type: 'button',
                text: messageData.content || '...',
                buttons: messageData.buttons.map((btn) => ({
                  type: 'web_url',
                  url: btn.url,
                  title: btn.title,
                })),
              },
            },
          };
        } else {
          payload.message = { text: messageData.content };
        }
        break;

      case 'image':
      case 'video':
      case 'audio':
        payload.message = {
          attachment: {
            type: messageData.type,
            payload: { url: messageData.media_url, is_reusable: true },
          },
        };
        break;

      case 'card':
        if (!messageData.cards || messageData.cards.length === 0) return false;
        payload.message = {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'generic',
              elements: messageData.cards.map((c) => ({
                title: c.title,
                subtitle: c.subtitle || '',
                image_url: c.image_url,
                default_action: {
                  type: 'web_url',
                  url: c.default_action_url || 'https://instagram.com',
                },
                buttons:
                  c.buttons && c.buttons.length > 0
                    ? c.buttons.map((btn) => ({
                        type: 'web_url',
                        url: btn.url,
                        title: btn.title,
                      }))
                    : undefined,
              })),
            },
          },
        };
        break;

      default:
        payload.message = { text: messageData.content || '...' };
    }

    await axios.post(`${GRAPH_URL}/me/messages`, payload, {
      params: { access_token: token },
    });
    console.log('✅ IG Reply Sent.');
    return true;
  } catch (e) {
    console.error('❌ Send Error:', e.response?.data || e.message);
    return false;
  }
}

module.exports = { handleMessage, handleComment };
