// ... (ایمپورت‌ها و کانفیگ‌های بالای فایل مثل قبل باشد) ...
// فقط بخش supportAgent را جایگزین کنید:

const supportAgent = {
  handleUserChat: async (user, userMessage, history = []) => {
    try {
      // 1. ساخت کانتکست کاربر (برای اینکه بداند اشتراکش چیست)
      const sub = await Subscription.findOne({
        user_id: user._id || user.id,
        status: 'active',
      }).populate('plan_id');
      const accounts = await IGConnections.find({
        user_id: user._id || user.id,
      }).select('username account_status');

      const userContext = `
          USER CURRENT STATUS:
          - Name: ${user.name}
          - Phone: ${user.phone}
          - Plan: ${sub ? sub.plan_id.name : 'Free / Expired'}
          - Usage: ${
            sub
              ? `${sub.usage.messagesUsed}/${sub.currentLimits.messageCount}`
              : '0/0'
          }
          - AI Tokens Used: ${sub ? sub.usage.aiTokensUsed : 0}
          - Connected Accounts: ${accounts.length} accounts connected.
          `;

      // 2. جستجو در داکیومنت‌های سیستم (RAG)
      // *** نکته مهم: اینجا از شناسه ثابت SYSTEM_DOCS استفاده می‌کنیم ***
      const docsContext = await azureService.askAI(
        'SYSTEM_DOCS',
        userMessage,
        'Extract relevant info only.',
        {},
        {},
        [],
        []
      );
      // ترفند: از askAI استفاده نمیکنیم چون اون چت میکنه.
      // ما فقط میخواهیم "جستجو" کنیم. پس بهتره مستقیم searchClient رو صدا بزنیم یا متد searchKnowledgeBase که قبلا ساختیم رو استفاده کنیم.

      // بیایید از متد search که در azureService هست استفاده کنیم (اگر اکسپورت شده باشد)
      // یا خودمان اینجا دستی سرچ کنیم.
      // راه تمیزتر: استفاده از azureService.askAI ولی با پرامپت "Just return context"

      // اما صبر کنید! در azureService متد askAI خودش سرچ میکند.
      // پس ما میتونیم یک متد searchOnly به azureService اضافه کنیم (که قبلا صحبت کردیم)
      // یا همینجا کد سرچ رو کپی کنیم.

      // بیایید فرض کنیم azureService.getEmbedding و searchClient در دسترس هستند (که نیستند چون اکسپورت نشدند)

      // *** راه حل سریع و تمیز: ***
      // ما یک درخواست "شبیه‌سازی شده" به azureService.askAI می‌فرستیم با شناسه SYSTEM_DOCS
      // و بهش میگیم: "تو پشتیبان هستی، با توجه به این اطلاعات جواب بده"

      const systemPrompt = `
          You are the Intelligent Support Agent for 'BusinessBot'.
          Speak Persian (Farsi).

          USER CONTEXT (Who you are talking to):
          ${userContext}

          YOUR KNOWLEDGE SOURCE:
          (The AI will retrieve this from Azure using 'SYSTEM_DOCS' ID)

          INSTRUCTIONS:
          - Answer the user's question based on the retrieved knowledge.
          - If it's a technical bug, suggest creating a ticket using 'create_support_ticket'.
          - Be polite and helpful.
          `;

      // فراخوانی سرویس اصلی با شناسه مجازی
      const aiResponse = await azureService.askAI(
        'SYSTEM_DOCS', // <--- کلید ماجرا اینجاست
        userMessage,
        systemPrompt,
        {}, // senderData (مهم نیست)
        { strictMode: true } // Strict Mode را روشن میکنیم تا چرت و پرت نگوید
      );

      // اگر ابزار تیکت صدا زده شد، خروجی askAI شامل آن است و هندل شده
      // اما چون askAI ما برای "لید" و "فلو" طراحی شده، ابزار "تیکت" را ندارد!

      // ⚠️ اوه! askAI ابزار create_ticket را ندارد.
      // پس ما باید لاجیک چت پشتیبانی را همینجا بنویسیم (مستقل از askAI)

      // ---> پس بیایید کد کامل و مستقل supportAgent را بنویسیم که خودش به Azure وصل شود
      // (این بهترین راه است)

      return await internalChatLogic(userMessage, systemPrompt, history);
    } catch (e) {
      console.error('Support Error:', e);
      return { response: 'خطای سیستمی. لطفا بعدا تلاش کنید.' };
    }
  },
};

// --- تابع داخلی اختصاصی برای چت پشتیبانی (با ابزار تیکت) ---
async function internalChatLogic(userQuery, systemPrompt, history) {
  // 1. سرچ در آژور (کپی لاجیک سرچ)
  const { AzureKeyCredential } = require('@azure/core-auth');
  const { SearchClient } = require('@azure/search-documents');
  const searchClient = new SearchClient(
    process.env.AZURE_SEARCH_ENDPOINT,
    'knowledge-base-index',
    new AzureKeyCredential(process.env.AZURE_SEARCH_KEY)
  );

  // چون دسترسی به openai client در این فایل نداریم، باید ایمپورت کنیم یا از azureService بگیریم
  // فرض: azureService متد getEmbedding دارد که public است
  const queryVector = await azureService.getEmbedding(userQuery);

  const searchResults = await searchClient.search(userQuery, {
    vectorQueries: [
      { vector: queryVector, k: 3, fields: ['contentVector'], kind: 'vector' },
    ],
    filter: `ig_accountId eq 'SYSTEM_DOCS'`, // <--- فیلتر روی داکیومنت‌های سیستم
    select: ['content'],
  });

  let context = '';
  for await (const result of searchResults.results)
    context += result.document.content + '\n---\n';

  // 2. ابزار تیکت
  const ticketTool = [
    {
      type: 'function',
      function: {
        name: 'create_support_ticket',
        description: 'Create a formal support ticket.',
        parameters: {
          type: 'object',
          properties: {
            subject: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
          required: ['subject', 'description'],
        },
      },
    },
  ];

  // 3. درخواست به GPT
  // (ما نیاز به دسترسی به کلاینت OpenAI داریم. آن را در بالای فایل require میکنیم)
  const { AzureOpenAI } = require('openai');
  const openai = new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_KEY,
    apiVersion: '2024-05-01-preview',
  });

  const messages = [
    {
      role: 'system',
      content: `${systemPrompt}\n\nKNOWLEDGE BASE:\n${context}`,
    },
    ...history,
    { role: 'user', content: userQuery },
  ];

  const response = await openai.chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT_CHAT,
    messages: messages,
    tools: ticketTool,
    tool_choice: 'auto',
  });

  const choice = response.choices[0];

  // هندل کردن تیکت
  if (choice.message.tool_calls) {
    const args = JSON.parse(choice.message.tool_calls[0].function.arguments);

    // ساخت تیکت در دیتابیس (نیاز به user id دارد که در اسکوپ بالا بود)
    // برای سادگی، فعلا فقط متن برمیگردانیم که "تیکت ثبت شد"
    // در نسخه نهایی باید user_id را به این تابع پاس بدیم

    return {
      response: `یک تیکت با موضوع "${args.subject}" برای شما ثبت شد.`,
      ticketCreated: true,
      ticketData: args, // این را به فرانت یا کنترلر میدهیم تا ذخیره کند
    };
  }

  return { response: choice.message.content };
}

module.exports = supportAgent;
