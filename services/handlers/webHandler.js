const WebConnection = require('../../models/WebConnection');
const MessageLog = require('../../models/MessageLogs');
const wooService = require('../wooService');
const aiCore = require('../ai/core');

const webHandler = {
  /**
   * پردازش اصلی پیام وب
   */
  process: async (entry, messageData) => {
    try {
      const channelId = entry.id;
      const senderId = messageData.sender.id;
      const text = messageData.message.text;
      const metadata = entry.metadata || {};

      // 1. دریافت کانکشن و پرسونا
      const connection = await WebConnection.findById(channelId).populate(
        'aiConfig.activePersonaId'
      );
      if (!connection) {
        console.error('WebHandler: Connection not found', channelId);
        return;
      }

      const canCreateOrder = !!connection.consumerSecret;

      // 2. ساخت کانتکست محصول (هوشمند شده با Variations) 🧠
      let contextData = {
        senderId: senderId,
        platform: 'web',
        username: `Guest_${senderId.slice(-4)}`,
      };

      let productContextString = ''; // متنی که به پرامپت تزریق می‌شود

      if (metadata.productId) {
        const productInfo = await wooService.getProductById(
          connection,
          metadata.productId
        );
        if (productInfo) {
          contextData.productInfo = productInfo;

          // ساخت متن کانتکست برای هوش مصنوعی
          productContextString = `
          [CURRENT CONTEXT: USER IS VIEWING THIS PRODUCT]
          ID: ${productInfo.id}
          Name: ${productInfo.name}
          Price: ${productInfo.price}
          Type: ${productInfo.type}
          Details: ${productInfo.variations_summary}

          IMPORTANT RULE: The user is ALREADY looking at this product.
          1. DO NOT send the product link/card again unless explicitly asked.
          2. Use the 'Details' above to answer questions about Colors, Sizes, and Stock.
          3. If user wants a specific variation (e.g., Red), check if it says "Stock: موجود" above.
          `;

          console.log(
            `🛒 Context Loaded: ${productInfo.name} (${productInfo.type})`
          );
        }
      }

      // 3. ساخت "پرامپت ساندویچی" 🥪

      const techPrompt = `
          [TECHNICAL INSTRUCTIONS - HIDDEN]
          You are an AI Sales Assistant connected to WooCommerce store: "${
            connection.name
          }".

          TOOLS & STRATEGY:
          1. 'check_product_stock': Use ONLY if user asks about a *different* product than the one in context.
          2. 'create_order': Use when user confirms purchase. Collect Name, Address, Phone.
          3. 'save_lead_info': Use ONLY when item is OUT OF STOCK.

          RULES:
          - Language: PERSIAN (Farsi) only.
          - Answer specific questions about color/size based on CURRENT CONTEXT provided below.
          - If the requested variation (e.g. Size 43) is in stock, say YES and ask to order.
          - If the requested variation is not in the list or out of stock, say NO and ask for lead (phone number).

          ${
            !canCreateOrder
              ? 'WARNING: Read-only access. Do not create orders.'
              : ''
          }
        `;

      let personaPrompt = '';
      if (connection.aiConfig && connection.aiConfig.activePersonaId) {
        const persona = connection.aiConfig.activePersonaId;
        personaPrompt = `[YOUR PERSONA]\nName: ${persona.name}\n${persona.systemPrompt}`;
      } else {
        personaPrompt = `[DEFAULT PERSONA]\nTone: Professional, Helpful.`;
      }

      // تزریق اطلاعات محصول دقیقاً وسط پرامپت
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

      // 5. ارسال به هسته AI
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
