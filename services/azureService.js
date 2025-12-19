const { AzureOpenAI } = require('openai');
const { AzureKeyCredential } = require('@azure/core-auth');
const { SearchIndexClient, SearchClient } = require('@azure/search-documents');
const crypto = require('crypto');
const Lead = require('../models/Lead');

console.log(
  '🟢 AZURE SERVICE v7 - FINAL FULL FEATURES (RAG + TOOLS + CONFIG) LOADED'
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

// بررسی مقادیر محیطی
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

// 3. تعریف ابزارها (Tools)
const tools = [
  {
    type: 'function',
    function: {
      name: 'save_lead_info',
      description:
        'Extract and save user contact information (Lead) when provided in the chat.',
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
            description: 'Product or service the user is interested in',
          },
        },
        required: ['phone'],
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
      return response.data[0].embedding;
    } catch (e) {
      console.error('Embedding Error:', e.message);
      throw e;
    }
  },

  /**
   * افزودن سند به پایگاه دانش
   */
  addDocument: async (igAccountId, title, content) => {
    try {
      await azureService.ensureIndexExists();

      const vector = await azureService.getEmbedding(content);

      // تولید شناسه امن
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
      console.log(`✅ Document indexed for ${igAccountId}`);
      return docId; // شناسه سند را برمی‌گردانیم
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
      console.log(`🗑️ Document ${docId} deleted from Azure.`);
      return true;
    } catch (e) {
      console.error('Azure Delete Error:', e.message);
      return false;
    }
  },

  /**
   * جستجو و پاسخ هوشمند (RAG + Tools + Config)
   */
  askAI: async (
    igAccountId,
    userQuery,
    systemInstruction,
    senderData = {},
    aiConfig = {}
  ) => {
    try {
      // تنظیمات پیش‌فرض
      const strictMode = aiConfig.strictMode ?? false;
      const temperature = aiConfig.creativity ?? 0.5;

      console.log(
        `🤖 AI Request | Account: ${igAccountId} | Strict: ${strictMode} | Temp: ${temperature}`
      );

      // 1. وکتور کردن سوال
      const queryVector = await azureService.getEmbedding(userQuery);

      // 2. جستجو در آژور سرچ
      const searchResults = await searchClient.search(userQuery, {
        vectorQueries: [
          {
            vector: queryVector,
            k: 5, // 5 نتیجه برتر برای دقت بیشتر
            fields: ['contentVector'],
            kind: 'vector',
          },
        ],
        filter: `ig_accountId eq '${igAccountId}'`,
        select: ['content', 'title'],
      });

      // 3. ساخت کانتکست
      let context = '';
      for await (const result of searchResults.results) {
        context += `[Source: ${result.document.title}]\n${result.document.content}\n---\n`;
      }

      if (!context) console.log('⚠️ No context found in KB.');

      // 4. ساخت دستورالعمل پویا بر اساس تنظیمات
      let promptLogic = '';
      if (strictMode) {
        promptLogic = `
          INSTRUCTIONS:
          1. Answer ONLY using the provided Context.
          2. If the answer is NOT in the Context, you MUST say: "متاسفانه اطلاعاتی در این مورد در فایل‌های من نیست."
          3. Do NOT use your own external knowledge.
          `;
      } else {
        promptLogic = `
          INSTRUCTIONS:
          1. Use the provided Context as your primary source.
          2. If the answer is not in the Context, use your general knowledge to answer politely.
          3. Prioritize the business information provided in the Context.
          `;
      }

      const finalSystemPrompt = `${systemInstruction}\n\n${promptLogic}\n\nCONTEXT FROM KNOWLEDGE BASE:\n${context}\n\nIMPORTANT: If the user provides a phone number, ALWAYS use the 'save_lead_info' tool.`;

      // 5. ارسال به GPT
      const messages = [
        { role: 'system', content: finalSystemPrompt },
        { role: 'user', content: userQuery },
      ];

      const response = await openai.chat.completions.create({
        model: chatDeployment,
        messages: messages,
        temperature: temperature,
        tools: tools,
        tool_choice: 'auto',
      });

      const choice = response.choices[0];
      const message = choice.message;

      // 6. هندل کردن Tool Calls (Lead Generation)
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];

        if (toolCall.function.name === 'save_lead_info') {
          const args = JSON.parse(toolCall.function.arguments);
          console.log('🎣 Lead Captured:', args);

          // ذخیره در دیتابیس (با بررسی اینکه مدل Lead وجود دارد)
          try {
            await Lead.create({
              ig_accountId: igAccountId,
              instagram_user_id: senderData.id || 'unknown',
              instagram_username: senderData.username || 'unknown',
              instagram_fullname: senderData.fullname || '',
              phone: args.phone,
              extracted_name: args.name,
              interest_product: args.product,
            });
          } catch (dbError) {
            console.log('⚠️ Lead save warning:', dbError.message);
          }

          // ادامه مکالمه با GPT
          messages.push(message);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              success: true,
              message: 'Lead saved successfully.',
            }),
          });

          const finalResponse = await openai.chat.completions.create({
            model: chatDeployment,
            messages: messages,
          });

          return {
            content: finalResponse.choices[0].message.content,
            usage: finalResponse.usage,
            leadCaptured: true,
          };
        }
      }

      return {
        content: message.content,
        usage: response.usage,
        leadCaptured: false,
      };
    } catch (e) {
      console.error('AI Generation Error:', e.message);
      return null;
    }
  },
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
      console.error('Simple Chat Error:', e.message);
      return 'مشکلی در سرویس دمو پیش آمده.';
    }
  },

  /**
   * تحلیل هوشمند پیام (احساسات + تگ‌گذاری + امتیازدهی)
   * خروجی JSON برای کاهش مصرف توکن و سرعت بالا
   */
  analyzeMessage: async (text) => {
    try {
      const systemPrompt = `
      Analyze the sentiment and intent of the user's message in Persian context.
      Return JSON ONLY. Format:
      {
        "sentiment": "positive" | "neutral" | "negative",
        "tags": ["tag1", "tag2"], (Max 3 tags, e.g., "Price Inquiry", "Complaint", "Support", "Ordering"),
        "score": number (0-100, where 100 is high purchase intent)
      }
      `;

      const response = await openai.chat.completions.create({
        model: chatDeployment, // یا مدل ارزان‌تر مثل gpt-35-turbo
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }, // تضمین خروجی JSON
      });

      return JSON.parse(response.choices[0].message.content);
    } catch (e) {
      console.error('Analysis Error:', e.message);
      // مقادیر پیش‌فرض در صورت خطا
      return { sentiment: 'neutral', tags: [], score: 10 };
    }
  },
};

module.exports = azureService;
