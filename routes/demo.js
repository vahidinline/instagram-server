const express = require('express');
const router = express.Router();
const azureService = require('../services/azureService');

// محدودیت ساده در حافظه (در پروداکشن واقعی بهتره از Redis استفاده بشه)
const rateLimit = new Map();

router.post('/chat', async (req, res) => {
  console.log('🚀 Demo chat endpoint hit');
  try {
    const { message } = req.body;
    const userIP = req.ip || req.connection.remoteAddress;

    // 1. بررسی لیمیت (حداکثر 10 پیام در ساعت برای هر IP)
    const usage = rateLimit.get(userIP) || { count: 0, time: Date.now() };
    if (Date.now() - usage.time > 3600000) {
      usage.count = 0; // ریست بعد از یک ساعت
      usage.time = Date.now();
    }

    if (usage.count >= 10) {
      return res.json({
        response:
          'تعداد پیام‌های تست شما تمام شده است. لطفاً برای ادامه ثبت‌نام کنید. 😊',
      });
    }

    rateLimit.set(userIP, { count: usage.count + 1, time: usage.time });

    // 2. پرامپت مخصوص دمو (معرفی خودِ سرویس)
    const demoSystemPrompt = `
        You are 'BusinessBot', a smart AI sales assistant.
        You are currently in 'Demo Mode' on the landing page.

        YOUR KNOWLEDGE BASE:
        - We help Instagram businesses automate DMs and Comments.
        - Features: AI Chatbot, Auto Reply, Lead Generation, Analytics.
        - Pricing: Free Plan (50 msgs), Pro Plan (299,000 Toman - 5000 msgs + AI).
        - We support Persian language perfectly.

        INSTRUCTIONS:
        - Answer short, friendly, and persuasive.
        - Use Emojis.
        - If asked about setup, say it takes only 2 minutes.
        `;

    // 3. ارسال به هوش مصنوعی (بدون RAG سنگین، فقط چت)
    // (مستقیم به GPT میفرستیم چون فایل خاصی برای دمو آپلود نکردیم، اطلاعات رو تو پرامپت دادیم)
    // اما از متد askAI استفاده نمیکنیم، مستقیم azureService رو صدا میزنیم یا یک متد سبک

    // نکته: برای سادگی از همان azureService.askAI استفاده میکنیم اما با igAccountId فیک
    // ولی چون askAI میره تو دیتابیس سرچ میکنه و ما فایلی برای دمو نداریم،
    // بهتره مستقیم chat completion بزنیم.

    // بیایید یک متد سبک به azureService اضافه کنیم یا همینجا هندل کنیم.
    // فرض میکنیم azureService یک متد simpleChat دارد (پایین کدش را میدهم)

    const aiResponse = await azureService.simpleChat(message, demoSystemPrompt);

    res.json({ response: aiResponse });
  } catch (e) {
    res.status(500).json({ error: 'Demo error' });
  }
});

module.exports = router;
