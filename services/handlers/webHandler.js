const WebConnection = require('../../models/WebConnection');
const MessageLog = require('../../models/MessageLogs');
const AnalyticsEvent = require('../../models/AnalyticsEvent'); // ✅ اضافه شد
const wooService = require('../wooService');
const aiCore = require('../ai/core');

const webHandler = {
  process: async (entry, messageData) => {
    try {
      const channelId = entry.id;
      const senderId = messageData.sender.id;
      const text = messageData.message.text;
      const metadata = entry.metadata || {};

      const connection = await WebConnection.findById(channelId).populate(
        'aiConfig.activePersonaId'
      );

      if (!connection) {
        console.error('WebHandler: Connection not found', channelId);
        return;
      }

      const activePersonaId = connection.aiConfig?.activePersonaId?._id || null;

      // ✅ ثبت آمار تعامل (Engagement) در هر پیام
      await AnalyticsEvent.create({
        ig_accountId: channelId,
        persona_id: activePersonaId,
        user_id: senderId,
        eventType: 'ENGAGEMENT',
      });

      const canCreateOrder = !!connection.consumerSecret;

      // 2. ساخت کانتکست محصول
      let contextData = {
        senderId: senderId,
        platform: 'web',
        username: `Guest_${senderId.slice(-4)}`,
        personaId: activePersonaId, // ارسال به Core برای ردیابی
        channelId: channelId, // ارسال به Core برای ردیابی
      };

      let productContextString = '';

      if (metadata.productId) {
        const productInfo = await wooService.getProductById(
          connection,
          metadata.productId
        );
        if (productInfo) {
          contextData.productInfo = productInfo;
          productContextString = `
          [CONTEXT: USER IS LOOKING AT THIS PRODUCT]
          Name: ${productInfo.name}
          Price: ${productInfo.price}
          Type: ${productInfo.type}
          Stock Data: ${productInfo.variations_summary}
          CRITICAL STOCK RULES:
          1. "Qty: X" -> Available (X items left).
          2. "Status: Available (Backorder Allowed)" -> AVAILABLE.
          3. "Out of Stock" -> NOT available.
          `;
          console.log(`🛒 Context Injected for: ${productInfo.name}`);
        }
      }

      // 3. پرامپت
      const techPrompt = `
          System Role: Sales Assistant for "${connection.name}".

          TOOLS:
          1. 'check_product_stock': Use to search OTHER items.
          2. 'create_order': Use ONLY after collecting Name, Address, Phone AND Item Details.
             - Group all items into ONE order (send 'items' array).
          3. 'save_lead_info': Use if out of stock.
          4. 'ask_multiple_choice': Use when you need user to pick a VARIATION (Weight/Color) or QUANTITY.

          CRITICAL RULES:
          - Prefer 'ask_multiple_choice' over plain text for choices.
          - Convert Persian words to numbers: "دو تا" -> 2.
          - If user wants multiple items, send: items: [{productId: ID_1kg, quantity: 2}]

          Language: Persian.
          ${!canCreateOrder ? 'Note: Read-only access enabled.' : ''}
        `;

      let personaPrompt = '';
      if (connection.aiConfig && connection.aiConfig.activePersonaId) {
        const persona = connection.aiConfig.activePersonaId;
        personaPrompt = `[YOUR PERSONA]\nName: ${persona.name}\n${persona.systemPrompt}`;
      } else {
        personaPrompt = `[DEFAULT PERSONA]\nTone: Professional, Helpful.`;
      }

      const finalSystemPrompt = `${techPrompt}\n\n${productContextString}\n\n${personaPrompt}`;

      console.log(`🤖 Web Processing for ${senderId}`);

      // 4. تاریخچه
      const history = await MessageLog.find({
        ig_accountId: channelId,
        sender_id: senderId,
      })
        .sort({ created_at: -1 })
        .limit(6)
        .then((logs) =>
          logs.reverse().map((l) => ({
            role: l.direction === 'incoming' ? 'user' : 'assistant',
            content: l.content,
          }))
        );

      // 5. ارسال به AI
      const aiResponse = await aiCore.ask({
        userText: text,
        systemPrompt: finalSystemPrompt,
        history,
        connection,
        contextData,
      });

      // 6. پاسخ به سوکت
      const roomName = `web_${channelId}_${senderId}`;
      let replyPayload = {
        direction: 'outgoing',
        created_at: new Date(),
      };

      if (aiResponse.type === 'products') {
        replyPayload.message_type = 'card';
        replyPayload.content = 'این محصولات را بررسی کنید:';
        replyPayload.products = aiResponse.data;
      } else if (aiResponse.type === 'options') {
        replyPayload.message_type = 'options';
        replyPayload.content = aiResponse.question;
        replyPayload.buttons = aiResponse.choices.map((c) => ({
          title: c,
          payload: c,
        }));
      } else {
        replyPayload.message_type = 'text';
        replyPayload.content = aiResponse.content;
      }

      if (global.io) {
        global.io.to(roomName).emit('new_message', replyPayload);
      }

      // 7. ذخیره در لاگ
      await MessageLog.create({
        ig_accountId: channelId,
        sender_id: senderId,
        content: replyPayload.content,
        direction: 'outgoing',
        status: 'replied',
        platform: 'web',
      });
    } catch (e) {
      console.error('❌ WebHandler Error:', e);
      if (global.io && messageData?.sender?.id) {
        global.io
          .to(`web_${entry.id}_${messageData.sender.id}`)
          .emit('error_message', { message: 'خطا در پردازش.' });
      }
    }
  },
};

module.exports = webHandler;
