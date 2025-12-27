const WebConnection = require('../../models/WebConnection');
const MessageLog = require('../../models/MessageLogs');
const wooService = require('../wooService');
const aiCore = require('../ai/core');

const webHandler = {
  /**
   * پردازش اصلی پیام وب
   * @param {Object} entry - داده‌های ورودی شامل id, platform, metadata
   * @param {Object} messageData - شامل sender و متن پیام
   */
  process: async (entry, messageData) => {
    try {
      const channelId = entry.id;
      const senderId = messageData.sender.id;
      const text = messageData.message.text;
      const metadata = entry.metadata || {};

      // 1. دریافت کانکشن و پرسونا (Populate)
      const connection = await WebConnection.findById(channelId).populate(
        'aiConfig.activePersonaId'
      );

      if (!connection) {
        console.error('WebHandler: Connection not found', channelId);
        return;
      }

      // ✅ امنیت: بررسی اینکه آیا دسترسی ثبت سفارش داریم؟
      // اگر consumerSecret خالی باشد، یعنی دسترسی نوشتن نداریم
      const canCreateOrder = !!connection.consumerSecret;

      // 2. ساخت کانتکست (Context Awareness)
      // اطلاعاتی که برای ثبت لید یا درک محصول نیاز است
      let contextData = {
        senderId: senderId, // حیاتی برای ثبت لید
        platform: 'web',
        username: `Guest_${senderId.slice(-4)}`,
      };

      // اگر کاربر در صفحه محصول است، اطلاعات آن را بگیر
      if (metadata.productId) {
        const productInfo = await wooService.getProductById(
          connection,
          metadata.productId
        );
        if (productInfo) {
          contextData.productInfo = productInfo;
          console.log(`🛒 User is viewing: ${productInfo.name}`);
        }
      }

      // 3. ساخت "پرامپت ساندویچی" (Sandwich Prompt) 🥪

      // لایه ۱: دستورالعمل‌های فنی (ثابت و استراتژیک)
      const techPrompt = `
          [TECHNICAL INSTRUCTIONS - HIDDEN]
          You are an AI Sales Assistant connected to WooCommerce store: "${
            connection.name
          }".

          TOOLS & STRATEGY:
          1. 'check_product_stock': Use this to find items.
          2. 'create_order': Use ONLY when user explicitly confirms they want to buy available item. Collect Address & Phone first.
          3. 'save_lead_info': Use ONLY when item is OUT OF STOCK. Say: "موجودی تمام شده. شماره تماس بگذارید تا خبرتان کنیم."

          RULES:
          - Language: PERSIAN (Farsi) only.
          - Do not be pushy. Use soft closing techniques.
          - Never make up URLs.

          ${
            !canCreateOrder
              ? 'WARNING: You do NOT have permission to create orders (No API Key). Just give product link.'
              : ''
          }
        `;

      // لایه ۲: لحن و پرسونا (متغیر از دیتابیس)
      let personaPrompt = '';
      if (connection.aiConfig && connection.aiConfig.activePersonaId) {
        const persona = connection.aiConfig.activePersonaId;
        personaPrompt = `
          [YOUR PERSONA - ACT LIKE THIS]
          Name: ${persona.name}
          ${persona.systemPrompt}

          Instructions: Maintain the sales goals defined above, but use the Tone and Style defined here.
            `;
      } else {
        // پرسونای پیش‌فرض
        personaPrompt = `
          [DEFAULT PERSONA]
          Tone: Professional, Helpful, Polite.
          Style: Short and concise.
            `;
      }

      // ترکیب نهایی
      const finalSystemPrompt = `${techPrompt}\n\n${personaPrompt}`;

      console.log(
        `🤖 Web Processing for ${senderId} | Persona: ${
          connection.aiConfig?.activePersonaId?.name || 'Default'
        }`
      );

      // 4. دریافت تاریخچه چت
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

      // 5. ارسال به هسته هوش مصنوعی
      const aiResponse = await aiCore.ask({
        userText: text,
        systemPrompt: finalSystemPrompt,
        history,
        connection,
        contextData, // پاس دادن کانتکست برای لید و محصول
      });

      // 6. آماده‌سازی پاسخ برای سوکت
      const roomName = `web_${channelId}_${senderId}`;
      let replyPayload = {
        direction: 'outgoing',
        created_at: new Date(),
      };

      if (aiResponse.type === 'products') {
        // حالت نمایش کارت محصول
        replyPayload.message_type = 'card';
        replyPayload.content = 'این محصولات را بررسی کنید:';
        replyPayload.products = aiResponse.data;
      } else {
        // حالت متن معمولی
        replyPayload.message_type = 'text';
        replyPayload.content = aiResponse.content;
      }

      // 7. ارسال به فرانت (ویجت)
      if (global.io) {
        global.io.to(roomName).emit('new_message', replyPayload);
      }

      // 8. ذخیره در لاگ
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
      // ارسال ارور به کاربر برای جلوگیری از بلاتکلیفی
      if (global.io && messageData?.sender?.id) {
        global.io
          .to(`web_${entry.id}_${messageData.sender.id}`)
          .emit('error_message', {
            message: 'متاسفانه خطایی رخ داد. لطفا دوباره تلاش کنید.',
          });
      }
    }
  },
};

module.exports = webHandler;
