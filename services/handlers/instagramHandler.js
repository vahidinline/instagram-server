const axios = require('axios');
const IGConnections = require('../../models/IG-Connections');
const Triggers = require('../../models/Triggers');
const Flows = require('../../models/Flows');
const MessageLog = require('../../models/MessageLogs');
const Customer = require('../../models/Customer');
const Campaign = require('../../models/Campaign');
const subManager = require('../subscriptionManager');
const azureService = require('../azureService');

// نسخه پایدار API اینستاگرام
const GRAPH_URL = 'https://graph.instagram.com/v22.0';

const instagramHandler = {
  /**
   * پردازش پیام‌های دایرکت (Direct Messages)
   */
  process: async (entry, messaging) => {
    try {
      // ✅ جلوگیری از لوپ (Echo & Self-Message Protection)
      if (messaging.message && messaging.message.is_echo) {
        // console.log('🔄 Echo message ignored.');
        return;
      }

      const igAccountId = entry.id; // ID پیج ما
      const senderId = messaging.sender.id; // ID فرستنده

      // ✅ گارد امنیتی دوم: اگر فرستنده همان پیج ما بود، نادیده بگیر
      if (senderId === igAccountId) {
        console.log('🛑 Self-message ignored to prevent loops.');
        return;
      }

      const text = messaging.message?.text;
      if (!text) return; // اگر پیام متن نداشت (مثلا لایک بود) و هندل نشده بود

      // 1. گیت‌کیپر (بررسی اشتراک)
      const quotaCheck = await subManager.checkLimit(igAccountId, 'instagram');
      if (!quotaCheck.allowed) {
        console.log(`⛔ IG Message Blocked: ${quotaCheck.reason}`);
        return;
      }

      // 2. دریافت اطلاعات اکانت
      const connection = await IGConnections.findOne({
        ig_userId: igAccountId,
      }).populate('aiConfig.activePersonaId');
      if (!connection) {
        console.error('❌ IG Connection not found.');
        return;
      }

      const token = connection.access_token;
      const botConfig = connection.botConfig || {
        isActive: true,
        responseDelay: 0,
      };
      const aiConfig = connection.aiConfig || { enabled: false };

      // 3. دریافت پروفایل کاربر
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

      if (hasAiAccess && text.length > 3) {
        try {
          const analysisResult = await azureService.analyzeMessage(
            text,
            currentStage
          );
          if (analysisResult?.result) analysis = analysisResult.result;
        } catch (e) {
          // console.error('CRM Analysis Fail:', e.message);
        }
      }

      await updateCustomer(
        igAccountId,
        senderId,
        userInfo,
        analysis,
        currentStage
      );

      // 5. اگر ربات خاموش است
      if (botConfig.isActive === false) return;

      // 6. جستجوی تریگر
      const trigger = await findMatchingTrigger(igAccountId, text, 'dm', null);

      if (trigger && trigger.flow_id) {
        console.log(`💡 IG Trigger Match: [${trigger.keywords.join(', ')}]`);

        const campaignCheck = await checkCampaignRules(trigger);
        if (!campaignCheck) return;

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

        if (campaignCheck.campaign) {
          await Campaign.findByIdAndUpdate(campaignCheck.campaign._id, {
            $inc: { 'limits.currentReplies': 1 },
          });
        }
      }
      // 7. هوش مصنوعی
      else if (aiConfig.enabled) {
        if (!hasAiAccess) return;
        const hasTokens = await subManager.checkAiLimit(
          quotaCheck.subscription
        );
        if (!hasTokens) return;

        console.log('🤖 IG Asking AI...');

        const history = await getChatHistory(igAccountId, senderId);
        const availableFlows = await Flows.find({
          ig_accountId: igAccountId,
        }).select('name');

        const systemPrompt =
          aiConfig.activePersonaId?.systemPrompt ||
          aiConfig.systemPrompt ||
          'You are a helpful assistant.';

        const aiResult = await azureService.askAI(
          igAccountId,
          text,
          systemPrompt,
          { id: senderId, username: userInfo.username },
          aiConfig,
          history,
          availableFlows,
          'instagram'
        );

        if (aiResult) {
          if (aiResult.usage?.total_tokens) {
            await subManager.incrementAiUsage(
              quotaCheck.subscription._id,
              aiResult.usage.total_tokens
            );
          }

          if (aiResult.action === 'trigger_flow') {
            const targetFlow = await Flows.findOne({
              ig_accountId: igAccountId,
              name: aiResult.flowName,
            });
            if (targetFlow) {
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
            }
          } else if (aiResult.content) {
            const sent = await sendReply(
              igAccountId,
              senderId,
              { content: aiResult.content, type: 'text' },
              token
            );
            if (sent) {
              await MessageLog.create({
                ig_accountId: igAccountId,
                sender_id: senderId,
                sender_username: userInfo.name || userInfo.username,
                content: aiResult.content,
                direction: 'outgoing',
                status: 'replied_ai',
                platform: 'instagram',
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('❌ IG Process Error:', e.message);
    }
  },

  // هندل کردن کامنت‌ها (بدون تغییر)
  handleComment: async (entry, change) => {
    try {
      const igAccountId = entry.id;
      const comment = change.value;
      const text = comment.text;
      const commentId = comment.id;
      const senderId = comment.from?.id;
      const senderUsername = comment.from?.username;
      const mediaId = comment.media?.id;

      if (!text || !senderId) return;

      const connection = await IGConnections.findOne({
        ig_userId: igAccountId,
      });
      if (!connection) return;
      if (senderUsername === connection.username) return; // ایگنور کردن کامنت خودمان

      const quotaCheck = await subManager.checkLimit(igAccountId, 'instagram');
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
          // 1. ریپلای عمومی
          if (botConfig.publicReplyText) {
            try {
              await axios.post(
                `${GRAPH_URL}/${commentId}/replies`,
                { message: botConfig.publicReplyText },
                { params: { access_token: token } }
              );
            } catch (e) {}
          }

          // 2. دایرکت خصوصی
          const firstMsg = flow.messages[0];
          let messageToSend = firstMsg.content;
          if (!messageToSend && firstMsg.type === 'card') {
            messageToSend =
              `👇 پیشنهادات:\n` +
              firstMsg.cards.map((c) => `🔹 ${c.title}`).join('\n');
          }

          if (botConfig.checkFollow) {
            messageToSend = `${
              botConfig.followWarning || 'لطفا فالو کنید'
            }\n\n${messageToSend}`;
          }

          if (firstMsg.buttons?.length > 0) {
            messageToSend +=
              '\n\n🔗 ' +
              firstMsg.buttons.map((b) => `${b.title}: ${b.url}`).join('\n');
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

            await subManager.incrementUsage(quotaCheck.subscription._id);
            if (campaign) {
              await Campaign.findByIdAndUpdate(campaign._id, {
                $inc: { 'limits.currentReplies': 1 },
              });
            }

            await MessageLog.create({
              ig_accountId: igAccountId,
              sender_id: senderId,
              sender_username: senderUsername,
              content: messageToSend,
              direction: 'outgoing',
              status: 'replied_comment',
              triggered_by: trigger._id,
              platform: 'instagram',
            });
          } catch (e) {
            console.error(
              'Private Reply Error:',
              e.response?.data || e.message
            );
          }
        }
      }
    } catch (e) {
      console.error('Comment Handler Error:', e);
    }
  },
};

// --- توابع کمکی (Helpers) ---
// (دقیقاً همان توابع فایل قبلی - بدون تغییر)
async function sendReply(accountId, recipientId, messageData, token) {
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
                buttons: c.buttons?.map((btn) => ({
                  type: 'web_url',
                  url: btn.url,
                  title: btn.title,
                })),
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
    console.error('❌ IG Send Error:', e.response?.data || e.message);
    return false;
  }
}

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
  const flow = await Flows.findById(trigger.flow_id || trigger.flowId);
  if (!flow) return;

  if (botConfig.responseDelay > 0)
    await new Promise((r) => setTimeout(r, botConfig.responseDelay * 1000));

  for (const msg of flow.messages) {
    let contentToSend = msg.content;
    let messageType = msg.type || 'text';

    if (msg.type === 'ai_response') {
      const systemPrompt = aiConfig.systemPrompt || 'Helpful assistant.';
      const hybridPrompt = msg.content
        ? `${systemPrompt}\n\nTask: ${msg.content}`
        : systemPrompt;

      const aiResult = await azureService.askAI(
        igAccountId,
        userText,
        hybridPrompt,
        { id: senderId, username: userInfo.username },
        aiConfig,
        [],
        [],
        'instagram'
      );

      if (!aiResult?.content) continue;
      contentToSend = aiResult.content;
      messageType = 'replied_ai';
    }

    const sent = await sendReply(
      igAccountId,
      senderId,
      { ...msg._doc, content: contentToSend, type: msg.type },
      token
    );

    if (sent) {
      if (messageType !== 'replied_ai')
        await subManager.incrementUsage(quotaCheck.subscription._id);

      await MessageLog.create({
        ig_accountId: igAccountId,
        sender_id: senderId,
        sender_username: userInfo.name || userInfo.username,
        content: contentToSend || `[${msg.type}]`,
        direction: 'outgoing',
        status: messageType,
        triggered_by: trigger._id,
        platform: 'instagram',
      });

      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (trigger._id)
    await Flows.findByIdAndUpdate(flow._id, { $inc: { usage_count: 1 } });
}

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

async function fetchUserProfile(senderId, myIgId, token) {
  try {
    const userRes = await axios.get(`${GRAPH_URL}/${senderId}`, {
      params: { fields: 'username,name', access_token: token },
    });
    const { username, name } = userRes.data;
    let profile_picture = '';
    if (username) {
      try {
        const dRes = await axios.get(`${GRAPH_URL}/${myIgId}`, {
          params: {
            fields: `business_discovery.username(${username}){profile_picture_url}`,
            access_token: token,
          },
        });
        profile_picture =
          dRes.data.business_discovery?.profile_picture_url || '';
      } catch (e) {}
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

async function updateCustomer(
  igAccountId,
  senderId,
  userInfo,
  analysis,
  currentStage
) {
  try {
    let updateQuery = {
      $set: {
        username: userInfo.username,
        fullName: userInfo.name,
        profilePic: userInfo.profile_picture,
        lastInteraction: new Date(),
        sentimentLabel: analysis.sentiment,
        platform: 'instagram',
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
    console.error('CRM Update Error:', e.message);
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

async function getChatHistory(igAccountId, senderId) {
  try {
    const logs = await MessageLog.find({ ig_accountId, sender_id: senderId })
      .sort({ created_at: -1 })
      .limit(6);
    return logs
      .reverse()
      .map((log) => ({
        role: log.direction === 'incoming' ? 'user' : 'assistant',
        content: log.content || '...',
      }));
  } catch (e) {
    return [];
  }
}

module.exports = instagramHandler;
