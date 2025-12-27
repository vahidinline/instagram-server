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
        senderId: senderId,
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

          // ✅ پرامپت کانتکست (بسیار دقیق شده)
          productContextString = `
          [CONTEXT: USER IS LOOKING AT THIS PRODUCT]
          Name: ${productInfo.name}
          Price: ${productInfo.price}
          Type: ${productInfo.type}

          [STOCK DATA - READ CAREFULLY]
          ${productInfo.variations_summary}

          CRITICAL RULES FOR STOCK:
          1. "Qty: X" means X items are available.
          2. "Status: In Stock (Unlimited)" means it IS AVAILABLE (Unlimited).
          3. "Status: Out of Stock" or "Qty: 0" means NOT available.
          4. If user asks for "1Kg" and you see "1 کیلوگرم" with "Status: In Stock", say YES, IT IS AVAILABLE.
          `;

          console.log(`🛒 Context Loaded for: ${productInfo.name}`);
        }
      }

      const techPrompt = `
          [TECHNICAL INSTRUCTIONS - HIDDEN]
          You are an AI Sales Assistant connected to WooCommerce store: "${
            connection.name
          }".

          TOOLS & STRATEGY:
          1. 'check_product_stock': Use ONLY for OTHER products (not the current one).
          2. 'create_order': Use when user confirms purchase.
             - REQUIRED ARGS: productId, fullName, address, phone.
             - IMPORTANT: Extract 'quantity' from user message (e.g. "4 ta mikham" -> quantity: 4). Default is 1.
          3. 'save_lead_info': Use ONLY when item is OUT OF STOCK.

          RULES:
          - Language: PERSIAN (Farsi) only.
          - If user wants multiple items (e.g. "2 ta"), MAKE SURE to pass 'quantity: 2' to the create_order tool.

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
          logs.reverse().map((l) => ({
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
      let replyPayload = {
        direction: 'outgoing',
        created_at: new Date(),
      };

      if (aiResponse.type === 'products') {
        replyPayload.message_type = 'card';
        replyPayload.content = 'این محصولات را بررسی کنید:';
        replyPayload.products = aiResponse.data;
      } else {
        replyPayload.message_type = 'text';
        replyPayload.content = aiResponse.content;
      }

      if (global.io) {
        global.io.to(roomName).emit('new_message', replyPayload);
      }

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
