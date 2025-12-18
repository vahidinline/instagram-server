const { AzureOpenAI } = require('openai');
const { AzureKeyCredential } = require('@azure/core-auth');
const { SearchIndexClient, SearchClient } = require('@azure/search-documents');
const crypto = require('crypto');
const Lead = require('../models/Lead'); // <--- اضافه شد: مدل لید

console.log('🟢 AZURE SERVICE v5 - FUNCTION CALLING (LEADS) LOADED');

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

// 3. تعریف ابزارها (Tools) برای Function Calling
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

  addDocument: async (igAccountId, title, content) => {
    try {
      await azureService.ensureIndexExists();
      const vector = await azureService.getEmbedding(content);
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
      return true;
    } catch (e) {
      console.error('Indexing Error:', e.message);
      return false;
    }
  },

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
   * جستجو و پاسخ هوشمند (RAG + Function Calling)
   */
  askAI: async (
    igAccountId,
    userQuery,
    systemInstruction = 'You are a helpful assistant.',
    senderData = {}
  ) => {
    try {
      // الف: وکتور کردن سوال
      const queryVector = await azureService.getEmbedding(userQuery);

      // ب: جستجو در آژور سرچ
      const searchResults = await searchClient.search(userQuery, {
        vectorQueries: [
          {
            vector: queryVector,
            k: 3,
            fields: ['contentVector'],
            kind: 'vector',
          },
        ],
        filter: `ig_accountId eq '${igAccountId}'`,
        select: ['content'],
      });

      // ج: ساخت کانتکست
      let context = '';
      for await (const result of searchResults.results) {
        context += result.document.content + '\n---\n';
      }

      // د: آماده‌سازی پیام‌ها برای GPT
      const messages = [
        {
          role: 'system',
          content: `${systemInstruction}\n\nCONTEXT FROM DATABASE:\n${context}\n\nIMPORTANT: If the user provides their phone number, you MUST use the 'save_lead_info' tool.`,
        },
        { role: 'user', content: userQuery },
      ];

      // هـ: ارسال اولیه به GPT
      const response = await openai.chat.completions.create({
        model: chatDeployment,
        messages: messages,
        temperature: 0.5,
        tools: tools, // ابزارها را معرفی میکنیم
        tool_choice: 'auto',
      });

      const choice = response.choices[0];
      const message = choice.message;

      // و: بررسی اینکه آیا GPT می‌خواهد تابعی را صدا بزند؟
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];

        if (toolCall.function.name === 'save_lead_info') {
          const args = JSON.parse(toolCall.function.arguments);
          console.log('🎣 AI is capturing a LEAD:', args);

          // 1. ذخیره در دیتابیس (Lead)
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
            console.log('✅ Lead saved to DB.');
          } catch (dbError) {
            console.log(
              '⚠️ Lead save warning (likely duplicate):',
              dbError.message
            );
          }

          // 2. بازگشت نتیجه تابع به GPT برای تولید متن نهایی
          messages.push(message); // اضافه کردن درخواست ابزار به تاریخچه
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              success: true,
              message: 'Lead saved successfully. Thank the user.',
            }),
          });

          // 3. درخواست دوم برای گرفتن متن نهایی
          const finalResponse = await openai.chat.completions.create({
            model: chatDeployment,
            messages: messages,
          });

          return {
            content: finalResponse.choices[0].message.content,
            usage: finalResponse.usage, // مصرف توکن (مجموع هر دو درخواست)
            leadCaptured: true,
          };
        }
      }

      // ز: حالت عادی (بدون صدا زدن ابزار)
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
};

module.exports = azureService;
