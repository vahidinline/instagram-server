const axios = require('axios');
const IGConnections = require('../models/IG-Connections');
const WebConnection = require('../models/WebConnection'); // <--- اضافه شد برای وب
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
  try {
    // 1. جلوگیری از لوپ (پیام‌های اکو)
    if (messaging.message && messaging.message.is_echo) return;

    const igAccountId = entry.id; // شناسه کانال (اینستا یا وب)
    const senderId = messaging.sender.id; // شناسه کاربر
    const text = messaging.message?.text;

    // تشخیص پلتفرم (اگر از روت وب بیاید، platform='web' ست شده است)
    const platform = entry.platform || 'instagram';

    if (!text) return;

    console.log(`📥 [${platform}] New Message from ${senderId}: ${text}`);

    // 2. بررسی اشتراک و محدودیت (Gatekeeper)
    // پلتفرم را پاس می‌دهیم تا در اشتراک‌منیجر درست جستجو کند
    const quotaCheck = await subManager.checkLimit(igAccountId, platform);

    if (!quotaCheck.allowed) {
      console.log(`⛔ Message Blocked: ${quotaCheck.reason}`);

      // اگر وب بود، ارور را به کاربر نمایش بده (چون سوکت باز است)
      if (platform === 'web' && global.io) {
        global.io
          .to(`web_${igAccountId}_${senderId}`)
          .emit('error_message', {
            message: 'Daily limit reached or subscription expired.',
          });
      }
      return;
    }

    // 3. دریافت اطلاعات اکانت و تنظیمات بر اساس پلتفرم
    let connection, token, botConfig, aiConfig;
    let isWeb = platform === 'web';

    if (isWeb) {
      // --- حالت وب (سایت/ووکامرس) ---
      connection = await WebConnection.findById(igAccountId);

      if (!connection) {
        console.error(`❌ Web Connection not found for ID: ${igAccountId}`);
        return;
      }

      token = 'WEB_TOKEN'; // توکن نمادین برای وب (چون Graph API نداریم)
      botConfig = connection.botConfig || { isActive: true, responseDelay: 0 };

      // تنظیمات AI برای وب (معمولاً در دیتابیس مدل وب AI Config ذخیره نمی‌شود، پس می‌سازیم)
      aiConfig = {
        enabled: true, // پیش‌فرض برای وب روشن است
        strictMode: false,
        creativity: 0.7,
        systemPrompt:
          connection.widgetConfig?.welcomeMessage ||
          'You are a helpful shop assistant.',
      };

      // اگر کاربر در تنظیمات ویجت، کانفیگ خاصی برای پرسونا ست کرده باشد (آینده)
      if (connection.aiConfig) {
        aiConfig = { ...aiConfig, ...connection.aiConfig };
      }
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

    // 4. دریافت پروفایل کاربر یا ساخت پروفایل مهمان
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
        // در وب نام کاربر مهمان است مگر اینکه لاگین کرده باشد (که فعلا هندل نمیکنیم)
        userInfo = {
          username: `Guest_${senderId.slice(-4)}`,
          name: 'Guest User',
          profile_picture: '',
        };
      } else if (token) {
        userInfo = await fetchUserProfile(senderId, igAccountId, token);
      }
    }

    // 5. تحلیل CRM (مشترک)
    // فقط اگر اشتراک اجازه دهد و متن کافی باشد
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

    if (hasAiAccess && text.length > 3) {
      try {
        // تحلیل پیام برای CRM (احساسات، تگ، امتیاز)
        const analysisResult = await azureService.analyzeMessage(
          text,
          currentStage
        );
        if (analysisResult?.result) {
          analysis = analysisResult.result;
        }
      } catch (e) {
        console.error('CRM Analysis Fail (Non-fatal):', e.message);
      }
    }

    // آپدیت یا ایجاد پروفایل مشتری در دیتابیس
    try {
      let updateQuery = {
        $set: {
          username: userInfo.username,
          fullName: userInfo.name,
          profilePic: userInfo.profile_picture,
          lastInteraction: new Date(),
          sentimentLabel: analysis.sentiment,
          platform: platform, // ذخیره پلتفرم مشتری
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

    // 6. ذخیره پیام ورودی در لاگ‌ها
    const incomingLog = await MessageLog.create({
      ig_accountId: igAccountId,
      sender_id: senderId,
      sender_username: userInfo.name || userInfo.username,
      sender_avatar: userInfo.profile_picture,
      content: text,
      direction: 'incoming',
      status: 'received',
      sentiment: analysis.sentiment,
      platform: platform, // ذخیره پلتفرم
    });

    // ارسال به سوکت (برای نمایش در فرانت پنل و ویجت)
    if (global.io) {
      if (isWeb) {
        // برای وب: ارسال به روم اختصاصی کاربر برای نمایش تیک دلیوری
        global.io
          .to(`web_${igAccountId}_${senderId}`)
          .emit('message_ack', { id: incomingLog._id, status: 'received' });

        // ارسال به پنل ادمین (اختیاری، اگر ادمین آنلاین باشد)
        // global.io.to(igAccountId).emit('new_message', incomingLog);
      } else {
        // برای اینستا: ارسال به روم ادمین
        global.io.to(igAccountId).emit('new_message', incomingLog);
      }
    }

    // 7. بررسی وضعیت ربات (اگر خاموش باشد، تمام)
    if (botConfig.isActive === false) return;

    // 8. جستجوی تریگر (کلمات کلیدی)
    // برای وب، مدیا آی‌دی نال است
    const trigger = await findMatchingTrigger(igAccountId, text, 'dm', null);

    if (trigger && trigger.flow_id) {
      console.log(`💡 Trigger Match: [${trigger.keywords.join(', ')}]`);

      // چک کردن قوانین کمپین
      const campaignCheck = await checkCampaignRules(trigger);
      if (!campaignCheck) return; // اگر محدودیت زمانی یا تعدادی کمپین پر شده باشد

      const campaign = campaignCheck.campaign;

      // اجرای فلو (Flow)
      // نکته: پلتفرم را پاس می‌دهیم تا executeFlow بداند کجا جواب بفرستد
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

      if (campaign) {
        await Campaign.findByIdAndUpdate(campaign._id, {
          $inc: { 'limits.currentReplies': 1 },
        });
      }
    }
    // 9. هوش مصنوعی خالص (اگر تریگر پیدا نشد)
    else if (aiConfig.enabled) {
      if (!hasAiAccess) return; // کاربر اشتراک AI ندارد

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

      // دریافت تاریخچه چت برای کانتکست
      const history = await getChatHistory(
        igAccountId,
        senderId,
        incomingLog._id
      );

      // لیست فلوهای موجود (برای اینکه AI بتواند پیشنهاد دهد)
      const availableFlows = await Flows.find({
        ig_accountId: igAccountId,
      }).select('name');

      // تعیین پرامپت نهایی
      let finalSystemPrompt = aiConfig.systemPrompt;
      if (!isWeb && aiConfig.activePersonaId) {
        // در اینستاگرام ممکن است پرسونا انتخاب شده باشد
        finalSystemPrompt = aiConfig.activePersonaId.systemPrompt;
      }

      // تعیین نوع کانال برای ابزارهای آژور (مهم برای ووکامرس)
      const channelType = isWeb ? 'web' : 'instagram';

      // فراخوانی سرویس Azure/OpenAI
      const aiResult = await azureService.askAI(
        igAccountId,
        text,
        finalSystemPrompt,
        senderData,
        aiConfig,
        history,
        availableFlows,
        channelType // <--- ارسال نوع کانال
      );

      if (aiResult) {
        // ثبت مصرف توکن
        if (aiResult.usage?.total_tokens) {
          await subManager.incrementAiUsage(
            quotaCheck.subscription._id,
            aiResult.usage.total_tokens
          );
        }

        // حالت الف: AI تشخیص داده که باید یک فلو اجرا شود
        if (aiResult.action === 'trigger_flow') {
          const targetFlow = await Flows.findOne({
            ig_accountId: igAccountId,
            name: aiResult.flowName,
          });
          if (targetFlow) {
            console.log(`🤖 AI Triggered Flow: ${targetFlow.name}`);
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
        // حالت ب: پاسخ متنی یا ابزار (مثل موجودی کالا)
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
              platform: platform,
            });

            // ارسال به سوکت صحیح
            if (global.io) {
              if (isWeb) {
                global.io
                  .to(`web_${igAccountId}_${senderId}`)
                  .emit('new_message', replyLog);
              } else {
                global.io.to(igAccountId).emit('new_message', replyLog);
              }
            }

            incomingLog.status = 'processed_ai';
            await incomingLog.save();
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Error in handleMessage Main Loop:', error);
  }
}

/**
 * 💬 پردازش کامنت (فقط اینستاگرام)
 * این تابع تغییر خاصی برای وب ندارد چون کامنت در وب معنی ندارد
 */
async function handleComment(entry, change) {
  try {
    const igAccountId = entry.id;
    const comment = change.value;
    const text = comment.text;
    const commentId = comment.id;
    const senderId = comment.from?.id;
    const senderUsername = comment.from?.username;
    const mediaId = comment.media?.id;

    if (!text || !senderId) return;

    // چک کردن کانکشن
    const connection = await IGConnections.findOne({ ig_userId: igAccountId });
    if (!connection) return;

    // اگر خودمان کامنت گذاشتیم، ایگنور کن
    if (senderUsername === connection.username) return;

    console.log(`💬 Comment from @${senderUsername}: ${text}`);

    // گیت‌کیپر
    const quotaCheck = await subManager.checkLimit(igAccountId, 'instagram');
    if (!quotaCheck.allowed) return;

    const token = connection.access_token;
    const botConfig = connection.botConfig || {};

    // جستجوی تریگر
    const trigger = await findMatchingTrigger(
      igAccountId,
      text,
      'comment',
      mediaId
    );

    if (trigger && trigger.flow_id) {
      // بررسی کمپین
      const campaignCheck = await checkCampaignRules(trigger);
      if (!campaignCheck) return;
      const campaign = campaignCheck.campaign;

      const flow = await Flows.findById(trigger.flow_id);

      if (flow) {
        // الف) ریپلای عمومی (Public Reply) زیر کامنت
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
        const firstMsg = flow.messages[0];
        let messageToSend = firstMsg.content;

        // اگر کارت یا دکمه بود و متن خالی بود
        if (!messageToSend) {
          if (firstMsg.type === 'card')
            messageToSend =
              `👇 لیست پیشنهادات:\n` +
              firstMsg.cards.map((c) => `🔹 ${c.title}`).join('\n');
          else messageToSend = 'پاسخ خودکار';
        }

        // اضافه کردن درخواست فالو اگر فعال باشد
        if (botConfig.checkFollow) {
          messageToSend = `${
            botConfig.followWarning || 'لطفا پیج را فالو کنید'
          }\n\n👇👇👇\n${messageToSend}`;
        }

        // اگر دکمه داشت، لینک‌ها را تکست کن (چون دایرکت کامنت محدودیت دارد)
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
            platform: 'instagram',
          });

          if (global.io)
            global.io.to(igAccountId).emit('new_message', replyLog);
        } catch (e) {
          console.error(
            '❌ Private Reply Error:',
            e.response?.data || e.message
          );
        }
      }
    }
  } catch (err) {
    console.error('Comment Error:', err);
  }
}

// ----------------------------------------------------------------
// توابع کمکی (Helpers)
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

/**
 * اجرای فلو (چند پلتفرمی)
 */
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

  // اعمال تاخیر اولیه
  if (botConfig.responseDelay > 0)
    await new Promise((r) => setTimeout(r, botConfig.responseDelay * 1000));

  for (const msg of flow.messages) {
    let contentToSend = msg.content;
    let messageType = msg.type || 'text'; // text, card, image...

    // اگر نود هوش مصنوعی بود (Dynamic AI Response)
    if (msg.type === 'ai_response') {
      const hasAccess = subManager.checkFeatureAccess(
        quotaCheck.subscription,
        'aiAccess'
      );
      if (!hasAccess) continue;

      const hasTokens = await subManager.checkAiLimit(quotaCheck.subscription);
      if (!hasTokens) continue;

      const systemPrompt = aiConfig.systemPrompt || 'Helpful assistant.';

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

      messageType = 'replied_ai'; // نوع پیام لاگ
    }

    // ارسال با پلتفرم صحیح
    const sent = await sendReply(
      igAccountId,
      senderId,
      { ...msg._doc, content: contentToSend, type: msg.type }, // merge msg doc with dynamic content
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
        platform: platform,
      });

      if (global.io) {
        if (platform === 'web') {
          global.io
            .to(`web_${igAccountId}_${senderId}`)
            .emit('new_message', log);
        } else {
          global.io.to(igAccountId).emit('new_message', log);
        }
      }

      // دیلی کوچک بین پیام‌های فلو برای طبیعی شدن
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // افزایش شمارنده استفاده از فلو
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

    // تلاش برای گرفتن عکس پروفایل (ممکن است بخاطر پرایوسی ندهد)
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

  // اولویت با تریگرهای خاص پست است
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
        // اگر دکمه داشت
        buttons: messageData.buttons || null,
        // اگر مدیا بود
        media_url: messageData.media_url,
        created_at: new Date(),
      };

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
