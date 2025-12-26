const { AzureOpenAI } = require('openai');
const { AzureKeyCredential } = require('@azure/core-auth');
const { SearchIndexClient, SearchClient } = require('@azure/search-documents');
const crypto = require('crypto');
const Lead = require('../models/Lead');
const WebConnection = require('../models/WebConnection');
const wooService = require('./wooService'); // سرویس ووکامرس

console.log(
  '🟢 AZURE SERVICE v15 - ULTIMATE (WOOCOMMERCE + ORDERS + RAG) LOADED'
);

// --- CONFIGURATION ---
const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_KEY;
const apiVersion = '2024-05-01-preview';
const chatDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_CHAT;
const embeddingDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_EMBEDDING;

const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
const searchKey = process.env.AZURE_SEARCH_KEY;
const indexName = process.env.AZURE_SEARCH_INDEX_NAME || 'knowledge-base-index';

if (!endpoint || !apiKey || !searchEndpoint || !searchKey) {
  console.error('❌ MISSING AZURE CONFIG in .env');
}

// 1. ساخت کلاینت OpenAI
const openai = new AzureOpenAI({
  endpoint,
  apiKey,
  apiVersion,
});

// 2. ساخت کلاینت‌های جستجو
const searchIndexClient = new SearchIndexClient(
  searchEndpoint,
  new AzureKeyCredential(searchKey)
);
const searchClient = new SearchClient(
  searchEndpoint,
  indexName,
  new AzureKeyCredential(searchKey)
);

// 3. ابزارهای پایه (لید جنریشن) - همیشه فعال
const baseTools = [
  {
    type: 'function',
    function: {
      name: 'save_lead_info',
      description:
        'Extract and save user contact information (Lead) when product is out of stock or user requests contact.',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description: 'User phone number (e.g., 0912...)',
          },
          name: { type: 'string', description: "User's name if provided" },
          product: {
            type: 'string',
            description: 'Product or service user is interested in',
          },
        },
        required: ['phone'],
      },
    },
  },
];

// 4. ابزارهای فروشگاه (ووکامرس) - فقط برای کانال وب فعال می‌شود
const shopTools = [
  {
    type: 'function',
    function: {
      name: 'check_product_stock',
      description:
        'Search for products in the online store to check price, stock, and details. ALWAYS use this before answering about products.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: "Product name or keyword (e.g. 'کلاه')",
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'track_order',
      description:
        'Check the status of an order using Order ID provided by the user.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'The numeric order ID' },
        },
        required: ['order_id'],
      },
    },
  },
  // ✅ ابزار جدید: ثبت سفارش
  {
    type: 'function',
    function: {
      name: 'create_order',
      description:
        'Create a new order in WooCommerce when user explicitly wants to buy. Ask for required details first.',
      parameters: {
        type: 'object',
        properties: {
          productId: {
            type: 'integer',
            description:
              'The numeric ID of the product found via check_product_stock',
          },
          quantity: { type: 'integer', default: 1 },
          firstName: { type: 'string', description: 'Customer first name' },
          lastName: { type: 'string', description: 'Customer last name' },
          phone: {
            type: 'string',
            description: 'Customer phone number (Essential)',
          },
          address: { type: 'string', description: 'Full shipping address' },
        },
        required: ['productId', 'phone', 'address'],
      },
    },
  },
];

const azureService = {
  /**
   * اطمینان از وجود ایندکس در آژور سرچ
   */
  ensureIndexExists: async () => {
    try {
      await searchIndexClient.getIndex(indexName);
    } catch (e) {
      console.log('⚠️ Index not found. Creating new index...');
      const indexObj = {
        name: indexName,
        fields: [
          { name: 'id', type: 'Edm.String', key: true, filterable: true },
          { name: 'content', type: 'Edm.String', searchable: true },
          { name: 'ig_accountId', type: 'Edm.String', filterable: true },
          { name: 'title', type: 'Edm.String', searchable: true },
          {
            name: 'contentVector',
            type: 'Collection(Edm.Single)',
            searchable: true,
            vectorSearchDimensions: 1536,
            vectorSearchProfileName: 'my-vector-profile',
          },
        ],
        vectorSearch: {
          algorithms: [{ name: 'my-hnsw-algo', kind: 'hnsw' }],
          profiles: [
            {
              name: 'my-vector-profile',
              algorithmConfigurationName: 'my-hnsw-algo',
            },
          ],
        },
      };
      await searchIndexClient.createIndex(indexObj);
      console.log('✅ Azure Search Index Created.');
    }
  },

  /**
   * تبدیل متن به وکتور (Embedding)
   */
  getEmbedding: async (text) => {
    try {
      const response = await openai.embeddings.create({
        input: text,
        model: embeddingDeployment,
      });
      return {
        vector: response.data[0].embedding,
        usage: response.usage.total_tokens,
      };
    } catch (e) {
      console.error('Embedding Error:', e.message);
      // throw e; // در پروداکشن نباید کرش کند
      return { vector: [], usage: 0 };
    }
  },

  /**
   * افزودن سند به پایگاه دانش
   */
  addDocument: async (igAccountId, title, content) => {
    try {
      await azureService.ensureIndexExists();
      const { vector, usage } = await azureService.getEmbedding(content);
      if (!vector || vector.length === 0) return false;

      const docId = crypto.randomBytes(16).toString('hex');

      const documents = [
        {
          id: docId,
          content: content,
          title: title,
          ig_accountId: igAccountId,
          contentVector: vector,
        },
      ];

      await searchClient.uploadDocuments(documents);
      console.log(
        `✅ Document indexed for ${igAccountId}. Embed Tokens: ${usage}`
      );
      return docId;
    } catch (e) {
      console.error('Indexing Error:', e.message);
      return false;
    }
  },

  /**
   * حذف سند
   */
  deleteDocument: async (docId) => {
    try {
      const documents = [{ id: docId, '@search.action': 'delete' }];
      await searchClient.uploadDocuments(documents);
      console.log(`🗑️ Document ${docId} deleted.`);
      return true;
    } catch (e) {
      console.error('Azure Delete Error:', e.message);
      return false;
    }
  },

  /**
   * آنالیز لحن (Tone Cloning)
   */
  analyzeTone: async (samples) => {
    try {
      const systemPrompt = `
      You are an expert Linguist. Analyze these Persian messages.
      Extract unique writing style, tone, emoji usage, and sentence structure.
      OUTPUT JSON ONLY:
      { "generatedSystemPrompt": "Write a prompt (in Persian) that instructs an AI to mimic this exact persona..." }
      `;

      const userContent = `Samples:\n${samples
        .map((s, i) => `${i + 1}. ${s}`)
        .join('\n')}`;

      const response = await openai.chat.completions.create({
        model: chatDeployment,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });

      const result = JSON.parse(response.choices[0].message.content);
      return result.generatedSystemPrompt;
    } catch (e) {
      console.error('Tone Analysis Error:', e.message);
      return 'تو یک دستیار هوشمند و مودب هستی.';
    }
  },

  /**
   * تحلیل هوشمند پیام (CRM Intelligence)
   */
  analyzeMessage: async (text, currentStage = 'lead') => {
    try {
      const systemPrompt = `
      You are an AI analyst for a CRM system. Analyze the message in Persian.
      CURRENT STAGE: "${currentStage}"
      SALES STAGES: lead, interested, negotiation, ready_to_buy, customer, churned.
      OUTPUT JSON ONLY:
      {
        "sentiment": "positive" | "neutral" | "negative",
        "tags": ["Tag1", "Tag2"],
        "score": number (0-100),
        "new_stage": "stage_name" | null
      }
      `;

      const response = await openai.chat.completions.create({
        model: chatDeployment,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      });

      return {
        result: JSON.parse(response.choices[0].message.content),
        usage: response.usage.total_tokens,
      };
    } catch (e) {
      return {
        result: { sentiment: 'neutral', tags: [], score: 0, new_stage: null },
        usage: 0,
      };
    }
  },

  /**
   * جستجو و پاسخ هوشمند (RAG + Tools + Memory + Flows + WooCommerce)
   */
  askAI: async (
    igAccountId,
    userQuery,
    systemInstruction = 'You are a helpful assistant.',
    senderData = {},
    aiConfig = {},
    history = [],
    availableFlows = [],
    channelType = 'instagram'
  ) => {
    try {
      let totalUsage = 0;
      const strictMode = aiConfig.strictMode ?? false;
      const temperature = aiConfig.creativity ?? 0.5;

      // 1. آماده‌سازی ابزارها (Tools)
      let dynamicTools = [...baseTools];
      let webConnection = null;

      // الف: افزودن ابزار اجرای فلو
      if (availableFlows.length > 0) {
        dynamicTools.push({
          type: 'function',
          function: {
            name: 'trigger_flow',
            description: `Trigger a pre-made flow if the user asks for: [${availableFlows
              .map((f) => f.name)
              .join(', ')}]`,
            parameters: {
              type: 'object',
              properties: {
                flow_name: {
                  type: 'string',
                  enum: availableFlows.map((f) => f.name),
                },
              },
              required: ['flow_name'],
            },
          },
        });
      }

      // ب: افزودن ابزارهای فروشگاه (فقط برای وب)
      if (channelType === 'web') {
        webConnection = await WebConnection.findById(igAccountId);

        // اگر پلتفرم ووکامرس بود یا هنوز مشخص نشده بود (برای سازگاری با نسخه‌های قبل)
        if (
          webConnection &&
          (!webConnection.platform || webConnection.platform === 'woocommerce')
        ) {
          console.log('🛒 Shop Tools Loaded for Web');
          dynamicTools = [...dynamicTools, ...shopTools];
        }
      }

      // 2. RAG (جستجو در دیتابیس متنی)
      // فقط اگر سوال کاربر طولانی باشد یا نیاز به دانش داشته باشد
      let context = '';
      if (userQuery.length > 5) {
        const { vector, usage: embedUsage } = await azureService.getEmbedding(
          userQuery
        );
        totalUsage += embedUsage;

        if (vector && vector.length > 0) {
          try {
            const searchResults = await searchClient.search(userQuery, {
              vectorQueries: [
                {
                  vector: vector,
                  k: 3,
                  fields: ['contentVector'],
                  kind: 'vector',
                },
              ],
              filter: `ig_accountId eq '${igAccountId}'`,
              select: ['content', 'title'],
            });

            for await (const result of searchResults.results) {
              context += `[Source: ${result.document.title}]\n${result.document.content}\n---\n`;
            }
          } catch (e) {
            console.log('Search skipped or failed:', e.message);
          }
        }
      }

      // 3. ساخت پرامپت نهایی
      let promptLogic = strictMode
        ? 'Answer ONLY using the provided Context.'
        : 'Use Context as primary source. Use general knowledge if needed.';

      const finalSystemPrompt = `${systemInstruction}\n\n${promptLogic}\n\nCONTEXT FROM KNOWLEDGE BASE:\n${context}\n\nIMPORTANT: If user gives phone number when product is out of stock, ALWAYS use 'save_lead_info'. If user wants to buy available product, ask for details and use 'create_order'.`;

      const messages = [
        { role: 'system', content: finalSystemPrompt },
        ...history,
        { role: 'user', content: userQuery },
      ];

      // 4. درخواست به GPT
      const response = await openai.chat.completions.create({
        model: chatDeployment,
        messages: messages,
        temperature: temperature,
        tools: dynamicTools,
        tool_choice: 'auto',
      });

      totalUsage += response.usage.total_tokens;
      const choice = response.choices[0];
      const message = choice.message;

      // 5. هندل کردن ابزارها (Function Calling)
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const args = JSON.parse(toolCall.function.arguments);
        let functionResult = null;

        // --- ابزار ۱: لید جنریشن ---
        if (toolCall.function.name === 'save_lead_info') {
          try {
            await Lead.create({
              ig_accountId,
              phone: args.phone,
              extracted_name: args.name,
              interest_product: args.product,
              ...senderData,
            });
            console.log('📝 Lead Captured:', args.phone);
          } catch (e) {}
          functionResult = {
            success: true,
            message: 'شماره تماس با موفقیت ذخیره شد. به کاربر بگو خبرش میکنیم.',
          };
        }

        // --- ابزار ۲: اجرای فلو ---
        else if (toolCall.function.name === 'trigger_flow') {
          return {
            action: 'trigger_flow',
            flowName: args.flow_name,
            usage: { total_tokens: totalUsage },
          };
        }

        // --- ابزار ۳: جستجوی محصول (فروشگاه) ---
        else if (toolCall.function.name === 'check_product_stock') {
          console.log('🛍️ Checking Stock:', args.query);
          functionResult = await wooService.searchProducts(
            webConnection,
            args.query
          );
        }

        // --- ابزار ۴: پیگیری سفارش (فروشگاه) ---
        else if (toolCall.function.name === 'track_order') {
          console.log('📦 Tracking Order:', args.order_id);
          functionResult = await wooService.getOrderStatus(
            webConnection,
            args.order_id
          );
        }

        // --- ابزار ۵: ثبت سفارش (✅ جدید) ---
        else if (toolCall.function.name === 'create_order') {
          console.log('🛒 Creating Order for:', args.phone);
          functionResult = await wooService.createOrder(webConnection, args);
        }

        // ارسال نتیجه ابزار به GPT برای تولید پاسخ نهایی
        if (functionResult) {
          messages.push(message); // اضافه کردن درخواست ابزار به تاریخچه
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(functionResult),
          });

          const finalRes = await openai.chat.completions.create({
            model: chatDeployment,
            messages,
          });
          totalUsage += finalRes.usage.total_tokens;

          return {
            content: finalRes.choices[0].message.content,
            usage: { total_tokens: totalUsage },
            leadCaptured: toolCall.function.name === 'save_lead_info',
          };
        }
      }

      return {
        content: message.content,
        usage: { total_tokens: totalUsage },
        leadCaptured: false,
      };
    } catch (e) {
      console.error('AI Error:', e.message);
      return null; // بازگشت نال باعث میشود سیستم کرش نکند
    }
  },

  /**
   * چت ساده برای دمو
   */
  simpleChat: async (userMessage, systemPrompt) => {
    try {
      const response = await openai.chat.completions.create({
        model: chatDeployment,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
      });
      return response.choices[0].message.content;
    } catch (e) {
      return 'Error in demo chat.';
    }
  },
};

module.exports = azureService;
