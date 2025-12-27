const WebConnection = require('../../models/WebConnection');
const MessageLog = require('../../models/MessageLogs');
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
      if (!connection) return;

      const canCreateOrder = !!connection.consumerSecret;
      let contextData = {
        senderId,
        platform: 'web',
        username: `Guest_${senderId.slice(-4)}`,
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
          Stock Data:
          ${productInfo.variations_summary}

          CRITICAL STOCK RULES:
          1. "Qty: X" -> Available (X left).
          2. "Status: Available (Backorder Allowed)" -> AVAILABLE (Even if qty is 0).
          3. "Out of Stock" -> Not available.
          `;
        }
      }

      const techPrompt = `
          [TECHNICAL INSTRUCTIONS]
          You are an AI Sales Assistant connected to WooCommerce store: "${
            connection.name
          }".

          TOOLS & STRATEGY:
          1. 'check_product_stock': For other products.
          2. 'create_order': Use ONLY after collecting Name, Address, Phone AND QUANTITY.
          3. 'save_lead_info': Use ONLY when OUT OF STOCK.

          RULES FOR ORDERING (STRICT):
          - Step 1: Check availability.
          - Step 2: If available, ask: "تعداد مورد نیاز شما چند تاست؟" (How many do you need?). << IMPORTANT
          - Step 3: Get Name, Address, Phone.
          - Step 4: Call 'create_order' with the extracted 'quantity'.
            (If user didn't specify number, do NOT guess. Ask them).

          ${!canCreateOrder ? 'WARNING: Read-only access.' : ''}
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

      const history = await MessageLog.find({
        ig_accountId: channelId,
        sender_id: senderId,
      })
        .sort({ created_at: -1 })
        .limit(6)
        .then((logs) =>
          logs
            .reverse()
            .map((l) => ({
              role: l.direction === 'incoming' ? 'user' : 'assistant',
              content: l.content,
            }))
        );

      const aiResponse = await aiCore.ask({
        userText: text,
        systemPrompt: finalSystemPrompt,
        history,
        connection,
        contextData,
      });

      const roomName = `web_${channelId}_${senderId}`;
      let replyPayload = { direction: 'outgoing', created_at: new Date() };

      if (aiResponse.type === 'products') {
        replyPayload.message_type = 'card';
        replyPayload.content = 'این محصولات را بررسی کنید:';
        replyPayload.products = aiResponse.data;
      } else {
        replyPayload.message_type = 'text';
        replyPayload.content = aiResponse.content;
      }

      if (global.io) global.io.to(roomName).emit('new_message', replyPayload);

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
