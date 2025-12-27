const WebConnection = require('../../models/WebConnection');
const MessageLog = require('../../models/MessageLogs');
const wooService = require('../wooService');
const aiCore = require('../ai/core');

const webHandler = {
  process: async (entry, messageData) => {
    const channelId = entry.id;
    const senderId = messageData.sender.id;
    const text = messageData.message.text;
    const metadata = entry.metadata || {}; // دیتای صفحه (Url, ProductID)

    // 1. دریافت کانکشن
    const connection = await WebConnection.findById(channelId);
    if (!connection) return;

    // 2. ساخت کانتکست (اگر کاربر در صفحه محصول باشد)
    let contextData = {};
    if (metadata.productId) {
      const productInfo = await wooService.getProductById(
        connection,
        metadata.productId
      );
      if (productInfo) contextData.productInfo = productInfo;
    }

    // 3. دریافت پرسونا (از دیتابیس یا دیفالت)
    // اینجا در آینده به ماژول Persona متصل می‌شود
    const personaPrompt =
      connection.aiConfig?.personaPrompt ||
      `تو فروشنده فروشگاه "${connection.name}" هستی. لحن: صمیمی و محترمانه. زبان: فارسی.`;

    // 4. ارسال به هوش مصنوعی
    console.log(
      `🤖 Web Handler: Processing for ${senderId} (Context: ${
        metadata.productId ? 'Product Page' : 'General'
      })`
    );

    // گرفتن تاریخچه کوتاه
    const history = await MessageLog.find({
      ig_accountId: channelId,
      sender_id: senderId,
    })
      .sort({ created_at: -1 })
      .limit(4)
      .then((logs) =>
        logs.reverse().map((l) => ({
          role: l.direction === 'incoming' ? 'user' : 'assistant',
          content: l.content,
        }))
      );

    const aiResponse = await aiCore.ask({
      userText: text,
      systemPrompt: personaPrompt,
      history,
      connection,
      contextData,
    });

    // 5. ارسال پاسخ به سوکت
    const roomName = `web_${channelId}_${senderId}`;
    let replyPayload = {
      direction: 'outgoing',
      created_at: new Date(),
    };

    if (aiResponse.type === 'products') {
      // اگر AI لیست محصول برگرداند (کاروسل)
      replyPayload.message_type = 'card';
      replyPayload.content = 'این محصولات را برای شما پیدا کردم:';
      replyPayload.products = aiResponse.data; // آرایه محصولات با عکس
    } else {
      // متن معمولی
      replyPayload.message_type = 'text';
      replyPayload.content = aiResponse.content;
    }

    if (global.io) {
      global.io.to(roomName).emit('new_message', replyPayload);
      console.log(`✅ Socket Sent to ${roomName}`);
    }

    // 6. ذخیره در لاگ (بدون ارسال مجدد)
    await MessageLog.create({
      ig_accountId: channelId,
      sender_id: senderId,
      content: replyPayload.content,
      direction: 'outgoing',
      status: 'replied',
      platform: 'web',
    });
  },
};

module.exports = webHandler;
