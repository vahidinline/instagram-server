// const axios = require('axios');
// const IGConnections = require('../models/IG-Connections');
// const WebConnection = require('../models/WebConnection');
// const Triggers = require('../models/Triggers');
// const Flows = require('../models/Flows');
// const MessageLog = require('../models/MessageLogs');
// const Customer = require('../models/Customer');
// const Campaign = require('../models/Campaign');
// const subManager = require('./subscriptionManager');
// const azureService = require('./azureService');

// // نسخه پایدار API اینستاگرام
// const GRAPH_URL = 'https://graph.instagram.com/v22.0';

// /**
//  * 📨 پردازش پیام (مشترک برای اینستاگرام و وب)
//  */
// async function handleMessage(entry, messaging) {
//   try {
//     // 1. جلوگیری از لوپ (پیام‌های اکو)
//     if (messaging.message && messaging.message.is_echo) return;

//     const igAccountId = entry.id; // شناسه کانال (اینستا یا وب)
//     const senderId = messaging.sender.id; // شناسه کاربر
//     const text = messaging.message?.text;

//     // تشخیص پلتفرم (اگر از روت وب بیاید، platform='web' ست شده است)
//     const platform = entry.platform || 'instagram';

//     if (!text) return;

//     console.log(`📥 [${platform}] New Message from ${senderId}: ${text}`);

//     // 2. بررسی اشتراک و محدودیت (Gatekeeper)
//     const quotaCheck = await subManager.checkLimit(igAccountId, platform);

//     if (!quotaCheck.allowed) {
//       console.log(`⛔ Message Blocked: ${quotaCheck.reason}`);

//       // اگر وب بود، ارور را به کاربر نمایش بده
//       if (platform === 'web' && global.io) {
//         global.io
//           .to(`web_${igAccountId}_${senderId}`)
//           .emit('error_message', {
//             message: 'Daily limit reached or subscription expired.',
//           });
//       }
//       return;
//     }

//     // 3. دریافت اطلاعات اکانت و تنظیمات بر اساس پلتفرم
//     let connection, token, botConfig, aiConfig;
//     let isWeb = platform === 'web';

//     if (isWeb) {
//       // --- حالت وب (سایت/ووکامرس) ---
//       connection = await WebConnection.findById(igAccountId);

//       if (!connection) {
//         console.error(`❌ Web Connection not found for ID: ${igAccountId}`);
//         return;
//       }

//       token = 'WEB_TOKEN'; // توکن نمادین برای وب
//       botConfig = connection.botConfig || { isActive: true, responseDelay: 0 };

//       // ✅ پرامپت حرفه‌ای فروشگاهی (فارسی) - آپدیت شده
//       const storeName = connection.name || 'فروشگاه';
//       const welcomeMsg =
//         connection.widgetConfig?.welcomeMessage ||
//         'سلام، چطور میتونم کمکتون کنم؟';

//       aiConfig = {
//         enabled: true, // همیشه برای وب روشن
//         strictMode: false,
//         creativity: 0.4, // خلاقیت کمتر برای دقت در فروش
//         // این پرامپت باعث می‌شود ربات فارسی صحبت کند و استراتژی فروش داشته باشد
//         systemPrompt: `
//           تو دستیار هوشمند فروشگاه اینترنتی "${storeName}" هستی.
//           وظایف تو:
//           1. همیشه و فقط به زبان "فارسی" صحبت کن. لحن تو باید محترمانه، گرم و حرفه‌ای باشد.
//           2. هدف اصلی تو "فروش محصول" است.
//           3. وقتی کاربر دنبال محصولی می‌گردد، حتما از ابزار "check_product_stock" استفاده کن.

//           قوانین استراتژیک (مهم):
//           - اگر محصول موجود بود: مشخصات، قیمت و عکس را نشان بده. سپس بپرس "آیا مایل به ثبت سفارش هستید؟". اگر بله گفت، اطلاعات (نام، آدرس، شماره تماس) را بگیر و ابزار "create_order" را اجرا کن.
//           - اگر محصول ناموجود بود یا پیدا نشد: حتما عذرخواهی کن و بگو "موجودی تمام شده اما اگر شماره تماس‌تان را بدهید، به محض شارژ شدن خبرتان می‌کنیم." به محض گرفتن شماره، ابزار "save_lead_info" را اجرا کن.

//           نکات:
//           - پاسخ‌هایت کوتاه و کاربردی باشد (حداکثر 3 خط).
//           - هرگز لینک یا اطلاعات خیالی از خودت نساز. فقط بر اساس خروجی ابزارها صحبت کن.
//           - پیام خوش‌آمدگویی پیش‌فرض تو: "${welcomeMsg}"
//         `,
//       };

//       // ادغام تنظیمات دستی کاربر اگر وجود داشته باشد
//       if (connection.aiConfig) {
//         aiConfig = { ...aiConfig, ...connection.aiConfig };
//       }
//     } else {
//       // --- حالت اینستاگرام ---
//       connection = await IGConnections.findOne({
//         ig_userId: igAccountId,
//       }).populate('aiConfig.activePersonaId');

//       if (!connection) {
//         console.error('❌ IG Connection not found.');
//         return;
//       }

//       token = connection.access_token;
//       botConfig = connection.botConfig || { isActive: true, responseDelay: 0 };
//       aiConfig = connection.aiConfig || { enabled: false };
//     }

//     // 4. دریافت پروفایل کاربر یا ساخت پروفایل مهمان
//     let userInfo = { username: 'User', profile_picture: '', name: '' };

//     const existingCustomer = await Customer.findOne({
//       ig_accountId: igAccountId,
//       sender_id: senderId,
//     });

//     if (existingCustomer && existingCustomer.username) {
//       userInfo = {
//         username: existingCustomer.username,
//         name: existingCustomer.fullName,
//         profile_picture: existingCustomer.profilePic,
//       };
//     } else {
//       if (isWeb) {
//         userInfo = {
//           username: `Guest_${senderId.slice(-4)}`,
//           name: 'Guest User',
//           profile_picture: '',
//         };
//       } else if (token) {
//         userInfo = await fetchUserProfile(senderId, igAccountId, token);
//       }
//     }

//     // 5. تحلیل CRM (مشترک)
//     let analysis = {
//       sentiment: 'neutral',
//       tags: [],
//       score: 0,
//       new_stage: null,
//     };

//     const hasAiAccess = subManager.checkFeatureAccess(
//       quotaCheck.subscription,
//       'aiAccess'
//     );
//     const currentStage = existingCustomer ? existingCustomer.stage : 'lead';

//     if (hasAiAccess && text.length > 3) {
//       try {
//         const analysisResult = await azureService.analyzeMessage(
//           text,
//           currentStage
//         );
//         if (analysisResult?.result) {
//           analysis = analysisResult.result;
//         }
//       } catch (e) {
//         console.error('CRM Analysis Fail (Non-fatal):', e.message);
//       }
//     }

//     // آپدیت پروفایل مشتری
//     try {
//       let updateQuery = {
//         $set: {
//           username: userInfo.username,
//           fullName: userInfo.name,
//           profilePic: userInfo.profile_picture,
//           lastInteraction: new Date(),
//           sentimentLabel: analysis.sentiment,
//           platform: platform,
//         },
//         $inc: {
//           interactionCount: 1,
//           leadScore: analysis.score > 0 ? Math.ceil(analysis.score / 10) : 0,
//         },
//         $addToSet: { tags: { $each: analysis.tags || [] } },
//       };

//       if (analysis.new_stage && analysis.new_stage !== currentStage) {
//         updateQuery.$set.stage = analysis.new_stage;
//         updateQuery.$push = {
//           stageHistory: {
//             from: currentStage,
//             to: analysis.new_stage,
//             date: new Date(),
//             reason: 'AI Analysis',
//           },
//         };
//       }

//       await Customer.findOneAndUpdate(
//         { ig_accountId: igAccountId, sender_id: senderId },
//         updateQuery,
//         { upsert: true, new: true, setDefaultsOnInsert: true }
//       );
//     } catch (e) {
//       console.error('CRM DB Error:', e.message);
//     }

//     // 6. ذخیره پیام ورودی
//     const incomingLog = await MessageLog.create({
//       ig_accountId: igAccountId,
//       sender_id: senderId,
//       sender_username: userInfo.name || userInfo.username,
//       sender_avatar: userInfo.profile_picture,
//       content: text,
//       direction: 'incoming',
//       status: 'received',
//       sentiment: analysis.sentiment,
//       platform: platform,
//     });

//     // ارسال به سوکت (ACK)
//     if (global.io) {
//       if (isWeb) {
//         global.io
//           .to(`web_${igAccountId}_${senderId}`)
//           .emit('message_ack', { id: incomingLog._id, status: 'received' });
//       } else {
//         global.io.to(igAccountId).emit('new_message', incomingLog);
//       }
//     }

//     // 7. بررسی وضعیت ربات
//     if (botConfig.isActive === false) return;

//     // 8. جستجوی تریگر
//     const trigger = await findMatchingTrigger(igAccountId, text, 'dm', null);

//     if (trigger && trigger.flow_id) {
//       console.log(`💡 Trigger Match: [${trigger.keywords.join(', ')}]`);

//       const campaignCheck = await checkCampaignRules(trigger);
//       if (!campaignCheck) return;
//       const campaign = campaignCheck.campaign;

//       await executeFlow(
//         trigger,
//         igAccountId,
//         senderId,
//         token,
//         botConfig,
//         quotaCheck,
//         userInfo,
//         text,
//         aiConfig,
//         platform
//       );

//       incomingLog.status = 'processed';
//       await incomingLog.save();

//       if (campaign) {
//         await Campaign.findByIdAndUpdate(campaign._id, {
//           $inc: { 'limits.currentReplies': 1 },
//         });
//       }
//     }
//     // 9. هوش مصنوعی
//     else if (aiConfig.enabled) {
//       if (!hasAiAccess) return;

//       const hasTokens = await subManager.checkAiLimit(quotaCheck.subscription);
//       if (!hasTokens) {
//         console.log('⛔ AI Token Limit Reached.');
//         return;
//       }

//       console.log('🤖 Asking AI...');

//       const senderData = {
//         id: senderId,
//         username: userInfo.username,
//         fullname: userInfo.name,
//       };

//       const history = await getChatHistory(
//         igAccountId,
//         senderId,
//         incomingLog._id
//       );

//       const availableFlows = await Flows.find({
//         ig_accountId: igAccountId,
//       }).select('name');

//       // تعیین پرامپت نهایی
//       let finalSystemPrompt = aiConfig.systemPrompt;
//       if (!isWeb && aiConfig.activePersonaId) {
//         finalSystemPrompt = aiConfig.activePersonaId.systemPrompt;
//       }

//       const channelType = isWeb ? 'web' : 'instagram';

//       const aiResult = await azureService.askAI(
//         igAccountId,
//         text,
//         finalSystemPrompt,
//         senderData,
//         aiConfig,
//         history,
//         availableFlows,
//         channelType
//       );

//       if (aiResult) {
//         if (aiResult.usage?.total_tokens) {
//           await subManager.incrementAiUsage(
//             quotaCheck.subscription._id,
//             aiResult.usage.total_tokens
//           );
//         }

//         // حالت الف: اجرای فلو
//         if (aiResult.action === 'trigger_flow') {
//           const targetFlow = await Flows.findOne({
//             ig_accountId: igAccountId,
//             name: aiResult.flowName,
//           });
//           if (targetFlow) {
//             await executeFlow(
//               { flow_id: targetFlow._id },
//               igAccountId,
//               senderId,
//               token,
//               botConfig,
//               quotaCheck,
//               userInfo,
//               text,
//               aiConfig,
//               platform
//             );
//           }
//         }
//         // حالت ب: پاسخ متنی
//         else if (aiResult.content) {
//           const sent = await sendReply(
//             igAccountId,
//             senderId,
//             { content: aiResult.content, type: 'text' },
//             token,
//             platform
//           );

//           if (sent) {
//             const replyLog = await MessageLog.create({
//               ig_accountId: igAccountId,
//               sender_id: senderId,
//               sender_username: userInfo.name || userInfo.username,
//               sender_avatar: userInfo.profile_picture,
//               content: aiResult.content,
//               direction: 'outgoing',
//               status: 'replied_ai',
//               platform: platform,
//             });

//             // ارسال به سوکت صحیح
//             if (global.io) {
//               if (isWeb) {
//                 global.io
//                   .to(`web_${igAccountId}_${senderId}`)
//                   .emit('new_message', replyLog);
//               } else {
//                 global.io.to(igAccountId).emit('new_message', replyLog);
//               }
//             }

//             incomingLog.status = 'processed_ai';
//             await incomingLog.save();
//           }
//         }
//       }
//     }
//   } catch (error) {
//     console.error('❌ Error in handleMessage Main Loop:', error);
//   }
// }

// /**
//  * 💬 پردازش کامنت (فقط اینستاگرام)
//  */
// async function handleComment(entry, change) {
//   try {
//     const igAccountId = entry.id;
//     const comment = change.value;
//     const text = comment.text;
//     const commentId = comment.id;
//     const senderId = comment.from?.id;
//     const senderUsername = comment.from?.username;
//     const mediaId = comment.media?.id;

//     if (!text || !senderId) return;

//     const connection = await IGConnections.findOne({ ig_userId: igAccountId });
//     if (!connection) return;

//     if (senderUsername === connection.username) return;

//     const quotaCheck = await subManager.checkLimit(igAccountId, 'instagram');
//     if (!quotaCheck.allowed) return;

//     const token = connection.access_token;
//     const botConfig = connection.botConfig || {};

//     const trigger = await findMatchingTrigger(
//       igAccountId,
//       text,
//       'comment',
//       mediaId
//     );

//     if (trigger && trigger.flow_id) {
//       const campaignCheck = await checkCampaignRules(trigger);
//       if (!campaignCheck) return;
//       const campaign = campaignCheck.campaign;

//       const flow = await Flows.findById(trigger.flow_id);

//       if (flow) {
//         // Public Reply
//         if (botConfig.publicReplyText) {
//           try {
//             await axios.post(
//               `${GRAPH_URL}/${commentId}/replies`,
//               { message: botConfig.publicReplyText },
//               { params: { access_token: token } }
//             );
//           } catch (e) {}
//         }

//         // Private Reply Logic
//         const firstMsg = flow.messages[0];
//         let messageToSend = firstMsg.content;

//         if (!messageToSend) {
//           if (firstMsg.type === 'card')
//             messageToSend =
//               `👇 لیست پیشنهادات:\n` +
//               firstMsg.cards.map((c) => `🔹 ${c.title}`).join('\n');
//           else messageToSend = 'پاسخ خودکار';
//         }

//         if (botConfig.checkFollow) {
//           messageToSend = `${
//             botConfig.followWarning || 'لطفا پیج را فالو کنید'
//           }\n\n👇👇👇\n${messageToSend}`;
//         }

//         if (firstMsg.buttons && firstMsg.buttons.length > 0) {
//           messageToSend +=
//             '\n\n🔗 لینک‌ها:\n' +
//             firstMsg.buttons.map((b) => `${b.title}: ${b.url}`).join('\n');
//         }

//         try {
//           await axios.post(
//             `${GRAPH_URL}/me/messages`,
//             {
//               recipient: { comment_id: commentId },
//               message: { text: messageToSend },
//             },
//             { params: { access_token: token } }
//           );

//           await subManager.incrementUsage(quotaCheck.subscription._id);

//           if (campaign)
//             await Campaign.findByIdAndUpdate(campaign._id, {
//               $inc: { 'limits.currentReplies': 1 },
//             });

//           const replyLog = await MessageLog.create({
//             ig_accountId: igAccountId,
//             sender_id: senderId,
//             sender_username: senderUsername,
//             content: messageToSend,
//             direction: 'outgoing',
//             status: 'replied_comment',
//             triggered_by: trigger._id,
//             platform: 'instagram',
//           });

//           if (global.io)
//             global.io.to(igAccountId).emit('new_message', replyLog);
//         } catch (e) {
//           console.error('Private Reply Error:', e.response?.data || e.message);
//         }
//       }
//     }
//   } catch (err) {
//     console.error('Comment Error:', err);
//   }
// }

// // --- توابع کمکی ---

// async function checkCampaignRules(trigger) {
//   if (!trigger.campaign_id) return { allowed: true, campaign: null };

//   const campaign = await Campaign.findById(trigger.campaign_id);
//   if (!campaign) return { allowed: true, campaign: null };

//   const now = new Date();
//   if (campaign.status !== 'active') return false;
//   if (
//     campaign.schedule.startDate &&
//     now < new Date(campaign.schedule.startDate)
//   )
//     return false;
//   if (campaign.schedule.endDate && now > new Date(campaign.schedule.endDate))
//     return false;
//   if (
//     campaign.limits.maxReplies > 0 &&
//     campaign.limits.currentReplies >= campaign.limits.maxReplies
//   )
//     return false;

//   return { allowed: true, campaign };
// }

// async function executeFlow(
//   trigger,
//   igAccountId,
//   senderId,
//   token,
//   botConfig,
//   quotaCheck,
//   userInfo,
//   userText,
//   aiConfig,
//   platform = 'instagram'
// ) {
//   const flow = await Flows.findById(trigger.flow_id || trigger.flowId);
//   if (!flow) return;

//   if (botConfig.responseDelay > 0)
//     await new Promise((r) => setTimeout(r, botConfig.responseDelay * 1000));

//   for (const msg of flow.messages) {
//     let contentToSend = msg.content;
//     let messageType = msg.type || 'text';

//     if (msg.type === 'ai_response') {
//       const hasAccess = subManager.checkFeatureAccess(
//         quotaCheck.subscription,
//         'aiAccess'
//       );
//       if (!hasAccess) continue;

//       const hasTokens = await subManager.checkAiLimit(quotaCheck.subscription);
//       if (!hasTokens) continue;

//       const systemPrompt = aiConfig.systemPrompt || 'Helpful assistant.';
//       const hybridPrompt = msg.content
//         ? `${systemPrompt}\n\nTask: ${msg.content}`
//         : systemPrompt;
//       const senderData = { id: senderId, username: userInfo.username };
//       const channelType = platform === 'web' ? 'web' : 'instagram';

//       const aiResult = await azureService.askAI(
//         igAccountId,
//         userText,
//         hybridPrompt,
//         senderData,
//         aiConfig,
//         [],
//         [],
//         channelType
//       );

//       if (!aiResult?.content) continue;
//       contentToSend = aiResult.content;
//       if (aiResult.usage?.total_tokens)
//         await subManager.incrementAiUsage(
//           quotaCheck.subscription._id,
//           aiResult.usage.total_tokens
//         );
//       messageType = 'replied_ai';
//     }

//     const sent = await sendReply(
//       igAccountId,
//       senderId,
//       { ...msg._doc, content: contentToSend, type: msg.type },
//       token,
//       platform
//     );

//     if (sent) {
//       if (messageType !== 'replied_ai')
//         await subManager.incrementUsage(quotaCheck.subscription._id);

//       const log = await MessageLog.create({
//         ig_accountId: igAccountId,
//         sender_id: senderId,
//         sender_username: userInfo.name || userInfo.username,
//         sender_avatar: userInfo.profile_picture,
//         content: contentToSend || `[${msg.type}]`,
//         direction: 'outgoing',
//         status: messageType,
//         triggered_by: trigger._id || null,
//         platform: platform,
//       });

//       if (global.io) {
//         if (platform === 'web')
//           global.io
//             .to(`web_${igAccountId}_${senderId}`)
//             .emit('new_message', log);
//         else global.io.to(igAccountId).emit('new_message', log);
//       }
//       await new Promise((r) => setTimeout(r, 1000));
//     }
//   }
//   if (trigger._id)
//     await Flows.findByIdAndUpdate(flow._id, { $inc: { usage_count: 1 } });
// }

// async function getChatHistory(igAccountId, senderId, currentMsgId) {
//   try {
//     const logs = await MessageLog.find({
//       ig_accountId,
//       sender_id: senderId,
//       _id: { $ne: currentMsgId },
//     })
//       .sort({ created_at: -1 })
//       .limit(6);

//     return logs.reverse().map((log) => ({
//       role: log.direction === 'incoming' ? 'user' : 'assistant',
//       content: log.content || '...',
//     }));
//   } catch (e) {
//     return [];
//   }
// }

// async function fetchUserProfile(senderId, myIgId, token) {
//   try {
//     const userRes = await axios.get(`${GRAPH_URL}/${senderId}`, {
//       params: { fields: 'username,name', access_token: token },
//     });
//     const { username, name } = userRes.data;
//     let profile_picture = '';
//     if (username) {
//       try {
//         const discoveryRes = await axios.get(`${GRAPH_URL}/${myIgId}`, {
//           params: {
//             fields: `business_discovery.username(${username}){profile_picture_url}`,
//             access_token: token,
//           },
//         });
//         profile_picture =
//           discoveryRes.data.business_discovery?.profile_picture_url || '';
//       } catch (err) {}
//     }
//     return {
//       username: username || 'User',
//       name: name || username,
//       profile_picture,
//     };
//   } catch (e) {
//     return { username: 'Instagram User', profile_picture: '', name: '' };
//   }
// }

// async function findMatchingTrigger(igAccountId, text, type, mediaId = null) {
//   if (!text) return null;
//   const allTriggers = await Triggers.find({
//     ig_accountId: igAccountId,
//     is_active: true,
//     type: { $in: [type, 'both'] },
//   });
//   const lowerText = text.toLowerCase().trim();
//   const sortedTriggers = allTriggers.sort((a, b) =>
//     a.media_id && !b.media_id ? -1 : !a.media_id && b.media_id ? 1 : 0
//   );

//   for (const trigger of sortedTriggers) {
//     if (!trigger.keywords) continue;
//     if (trigger.media_id && trigger.media_id !== mediaId) continue;
//     for (const keyword of trigger.keywords) {
//       const k = keyword.toLowerCase().trim();
//       if (trigger.match_type === 'exact' && lowerText === k) return trigger;
//       if (trigger.match_type === 'contains' && lowerText.includes(k))
//         return trigger;
//       if (trigger.match_type === 'starts_with' && lowerText.startsWith(k))
//         return trigger;
//     }
//   }
//   return null;
// }

// async function sendReply(
//   accountId,
//   recipientId,
//   messageData,
//   token,
//   platform = 'instagram'
// ) {
//   try {
//     if (platform === 'web') {
//       const roomName = `web_${accountId}_${recipientId}`;
//       let socketPayload = {
//         direction: 'outgoing',
//         content: messageData.content,
//         message_type: messageData.type || 'text',
//         products: messageData.type === 'card' ? messageData.cards : null,
//         buttons: messageData.buttons || null,
//         media_url: messageData.media_url,
//         created_at: new Date(),
//       };
//       if (global.io) {
//         global.io.to(roomName).emit('new_message', socketPayload);
//         console.log(`📤 Sending to Web Socket: ${roomName}`);
//         return true;
//       }
//       return false;
//     }

//     let payload = { recipient: { id: recipientId }, message: {} };
//     switch (messageData.type) {
//       case 'text':
//       case 'ai_response':
//         if (messageData.buttons && messageData.buttons.length > 0) {
//           payload.message = {
//             attachment: {
//               type: 'template',
//               payload: {
//                 template_type: 'button',
//                 text: messageData.content || '...',
//                 buttons: messageData.buttons.map((btn) => ({
//                   type: 'web_url',
//                   url: btn.url,
//                   title: btn.title,
//                 })),
//               },
//             },
//           };
//         } else {
//           payload.message = { text: messageData.content };
//         }
//         break;
//       case 'image':
//       case 'video':
//       case 'audio':
//         payload.message = {
//           attachment: {
//             type: messageData.type,
//             payload: { url: messageData.media_url, is_reusable: true },
//           },
//         };
//         break;
//       case 'card':
//         if (!messageData.cards || messageData.cards.length === 0) return false;
//         payload.message = {
//           attachment: {
//             type: 'template',
//             payload: {
//               template_type: 'generic',
//               elements: messageData.cards.map((c) => ({
//                 title: c.title,
//                 subtitle: c.subtitle || '',
//                 image_url: c.image_url,
//                 default_action: {
//                   type: 'web_url',
//                   url: c.default_action_url || 'https://instagram.com',
//                 },
//                 buttons:
//                   c.buttons && c.buttons.length > 0
//                     ? c.buttons.map((btn) => ({
//                         type: 'web_url',
//                         url: btn.url,
//                         title: btn.title,
//                       }))
//                     : undefined,
//               })),
//             },
//           },
//         };
//         break;
//       default:
//         payload.message = { text: messageData.content || '...' };
//     }
//     await axios.post(`${GRAPH_URL}/me/messages`, payload, {
//       params: { access_token: token },
//     });
//     console.log('✅ IG Reply Sent.');
//     return true;
//   } catch (e) {
//     console.error('❌ Send Error:', e.response?.data || e.message);
//     return false;
//   }
// }

// module.exports = { handleMessage, handleComment };

const webHandler = require('./handlers/webHandler');
const instagramHandler = require('./handlers/instagramHandler');
const MessageLog = require('../models/MessageLogs');

const processor = {
  /**
   * Main Dispatcher: Receives message, Logs it, Routes to Handler
   */
  handleMessage: async (entry, messaging) => {
    try {
      const platform = entry.platform || 'instagram';
      const senderId = messaging.sender.id;
      const text = messaging.message?.text;

      if (!text) return;

      console.log(
        `📥 [${platform}] Received from ${senderId}: ${text.substring(
          0,
          30
        )}...`
      );

      // 1. ذخیره پیام ورودی (مشترک برای همه پلتفرم‌ها)
      // نکته مهم: اینجا دیگر message_ack را به سوکت Emit نمی‌کنیم تا از تکرار پیام در فرانت جلوگیری شود.
      // خود فرانت‌اند به محض ارسال پیام توسط کاربر، آن را نمایش می‌دهد.
      await MessageLog.create({
        ig_accountId: entry.id,
        sender_id: senderId,
        content: text,
        direction: 'incoming',
        status: 'received',
        platform: platform,
      });

      // 2. توزیع به هندلر اختصاصی
      if (platform === 'web') {
        await webHandler.process(entry, messaging);
      } else {
        await instagramHandler.process(entry, messaging);
      }
    } catch (e) {
      console.error('❌ Dispatcher Error:', e);
    }
  },

  // هدایت کامنت‌ها (فقط اینستاگرام)
  handleComment: async (entry, change) => {
    await instagramHandler.handleComment(entry, change);
  },
};

module.exports = processor;
