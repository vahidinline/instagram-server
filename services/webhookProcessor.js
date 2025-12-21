const axios = require('axios');
const IGConnections = require('../models/IG-Connections');
const Triggers = require('../models/Triggers');
const Flows = require('../models/Flows');
const MessageLog = require('../models/MessageLogs');
const Customer = require('../models/Customer');
const subManager = require('./subscriptionManager');
const azureService = require('./azureService');

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

  console.log(`📥 New Message from ${senderId}: ${text}`);

  // 1. Gatekeeper
  const quotaCheck = await subManager.checkLimit(igAccountId);
  if (!quotaCheck.allowed) {
    console.log(`⛔ Blocked: ${quotaCheck.reason}`);
    return;
  }

  try {
    // 2. Load Account & Config
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

    // 3. User Profile
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
    } else if (token) {
      userInfo = await fetchUserProfile(senderId, igAccountId, token);
    }

    // 4. CRM Analysis
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
      } catch (e) {}
    }

    // Update CRM
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
            reason: 'AI',
          },
        };
      }

      await Customer.findOneAndUpdate(
        { ig_accountId: igAccountId, sender_id: senderId },
        updateQuery,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (e) {}

    // 5. Incoming Log
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

    if (global.io) global.io.to(igAccountId).emit('new_message', incomingLog);

    // 6. Bot Active Check
    if (botConfig.isActive === false) return;

    // 7. Trigger Search
    const trigger = await findMatchingTrigger(igAccountId, text, 'dm', null);

    if (trigger && trigger.flow_id) {
      console.log(`💡 Trigger: ${trigger.keywords[0]}`);
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
    }
    // 8. AI Processing (with Flow Tools)
    else if (aiConfig.enabled) {
      if (!hasAiAccess) return;
      const hasTokens = await subManager.checkAiLimit(quotaCheck.subscription);
      if (!hasTokens) return;

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
      const history = await getChatHistory(
        igAccountId,
        senderId,
        incomingLog._id
      );

      // *** Fetch Available Flows for AI ***
      const availableFlows = await Flows.find({
        ig_accountId: igAccountId,
      }).select('name');

      const aiResult = await azureService.askAI(
        igAccountId,
        text,
        systemPrompt,
        senderData,
        aiConfig,
        history,
        availableFlows // <--- ارسال لیست فلوها
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
            // اجرای فلو (شبیه‌سازی تریگر)
            await executeFlow(
              { flow_id: targetFlow._id },
              igAccountId,
              senderId,
              token,
              botConfig,
              quotaCheck,
              userInfo,
              text,
              aiConfig
            );
            console.log(`🤖 AI Executed Flow: ${targetFlow.name}`);
          }
        }
        // حالت ب: پاسخ متنی معمولی
        else if (aiResult.content) {
          const sent = await sendReply(
            igAccountId,
            senderId,
            { content: aiResult.content, type: 'text' },
            token
          );
          if (sent) {
            const replyLog = await MessageLog.create({
              ig_accountId: igAccountId,
              sender_id: senderId,
              sender_username: userInfo.name,
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
    console.error('❌ Error:', error.message);
  }
}

// --- Helper: Execute Flow ---
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

  if (botConfig.responseDelay > 0)
    await new Promise((r) => setTimeout(r, botConfig.responseDelay * 1000));

  for (const msg of flow.messages) {
    let contentToSend = msg.content;
    let messageType = 'replied';

    if (msg.type === 'ai_response') {
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

      // در فلوهای ترکیبی، لیست فلوها را خالی می‌فرستیم تا لوپ نشود
      const aiResult = await azureService.askAI(
        igAccountId,
        userText,
        hybridPrompt,
        senderData,
        aiConfig,
        [],
        []
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
        sender_username: userInfo.name,
        sender_avatar: userInfo.profile_picture,
        content: contentToSend,
        direction: 'outgoing',
        status: messageType,
        triggered_by: trigger._id || null,
      });
      if (global.io) global.io.to(igAccountId).emit('new_message', log);
    }
  }
  await Flows.findByIdAndUpdate(flow._id, { $inc: { usage_count: 1 } });
}

// --- Helper: Chat History ---
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
      content: log.content,
    }));
  } catch (e) {
    return [];
  }
}

// --- Other Helpers (Unchanged) ---
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
                text: messageData.content,
                buttons: messageData.buttons,
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
        payload.message = {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'generic',
              elements: messageData.cards.map((c) => ({
                title: c.title,
                subtitle: c.subtitle,
                image_url: c.image_url,
                default_action: { type: 'web_url', url: c.default_action_url },
                buttons: c.buttons,
              })),
            },
          },
        };
        break;
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
  /* (این بخش بدون تغییر است، می‌توانید از کد قبلی استفاده کنید یا اگر می‌خواهید اینجا بگذارم) */
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
