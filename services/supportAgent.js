const { AzureOpenAI } = require('openai');
const { AzureKeyCredential } = require('@azure/core-auth');
const azureService = require('./azureService');
const Subscription = require('../models/Subscription');
const IGConnections = require('../models/IG-Connections');
const Ticket = require('../models/Ticket');

console.log('🟢 SUPPORT AGENT v2 - TICKET FIX LOADED');

// --- CONFIGURATION ---
const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_KEY;
const apiVersion = '2024-05-01-preview';
const chatDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_CHAT;

// آی‌دی اکانت ادمین برای داکیومنت‌ها
const ADMIN_SUPPORT_IG_ID = 'SYSTEM_DOCS'; // از شناسه ثابت استفاده کردیم

if (!endpoint || !apiKey) {
  console.error('❌ MISSING AZURE OPENAI CONFIG for Support Agent');
}

const openai = new AzureOpenAI({
  endpoint,
  apiKey,
  apiVersion,
});

const tools = [
  {
    type: 'function',
    function: {
      name: 'create_support_ticket',
      description: 'Create a formal support ticket for the user.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Short title of the issue' },
          description: {
            type: 'string',
            description: 'Detailed description of the problem',
          },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['subject', 'description', 'priority'],
      },
    },
  },
];

const supportAgent = {
  handleUserChat: async (user, userMessage, history = []) => {
    try {
      // 1. دریافت کانتکست
      const userId = user._id || user.id; // هندل کردن هر دو حالت

      const sub = await Subscription.findOne({
        user_id: userId,
        status: 'active',
      }).populate('plan_id');
      const accounts = await IGConnections.find({ user_id: userId }).select(
        'username account_status'
      );

      const userContext = `
          User ID: ${userId}
          Name: ${user.name}
          Phone: ${user.phone}
          Plan: ${sub ? sub.plan_id.name : 'Free'}
          Accounts: ${accounts.length}
          `;

      // 2. جستجو در داکیومنت‌ها
      let docsContext = 'No specific documentation found.';
      try {
        docsContext = await azureService.askAI(
          ADMIN_SUPPORT_IG_ID,
          userMessage,
          'Extract info',
          {},
          {},
          [],
          []
        );
        // نکته: اینجا از askAI فقط برای سرچ استفاده میکنیم، بهتر بود متد جدا داشتیم ولی این هم کار میکند
        // اگر خروجی askAI متن بود استفاده میکنیم
        if (typeof docsContext !== 'string') docsContext = 'No docs.';
      } catch (e) {
        console.log('Docs search skipped');
      }

      // 3. پرامپت
      const systemPrompt = `
          You are 'BusinessBot Support'.
          User Info: ${userContext}
          Docs: ${docsContext}

          Instructions:
          - Speak Persian.
          - If user wants to create a ticket or reports a bug, USE 'create_support_ticket'.
          - Otherwise answer based on docs.
          `;

      // 4. درخواست GPT
      const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage },
      ];

      const response = await openai.chat.completions.create({
        model: chatDeployment,
        messages: messages,
        temperature: 0.3,
        tools: tools,
        tool_choice: 'auto',
      });

      const choice = response.choices[0];
      const message = choice.message;

      // 5. هندل کردن تیکت
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];

        if (toolCall.function.name === 'create_support_ticket') {
          const args = JSON.parse(toolCall.function.arguments);
          console.log('🎫 Creating Ticket:', args);

          try {
            const newTicket = await Ticket.create({
              user_id: userId,
              subject: args.subject,
              priority: args.priority || 'medium',
              status: 'open',
              messages: [
                {
                  sender: 'ai',
                  content: `[ثبت خودکار توسط هوش مصنوعی]\n\n${args.description}`,
                },
              ],
            });

            console.log('✅ Ticket Created ID:', newTicket._id);

            // پیام تایید به کاربر
            return {
              response: `یک تیکت با شماره #${newTicket._id
                .toString()
                .slice(-6)} برای شما ثبت شد. همکاران ما بررسی می‌کنند.`,
              ticketCreated: true,
            };
          } catch (dbError) {
            console.error('❌ DB Ticket Error:', dbError);
            return { response: 'مشکلی در ثبت تیکت پیش آمد.' };
          }
        }
      }

      return {
        response: message.content,
        ticketCreated: false,
      };
    } catch (e) {
      console.error('Support Agent Error:', e);
      return { response: 'خطای سیستم پشتیبانی.' };
    }
  },
};

module.exports = supportAgent;
