const { AzureOpenAI } = require('openai');
const { AzureKeyCredential } = require('@azure/core-auth');
const { SearchIndexClient, SearchClient } = require('@azure/search-documents');
const crypto = require('crypto');
const Lead = require('../models/Lead');

console.log(
  '🟢 AZURE SERVICE v13 - ULTIMATE (TONE + CRM + LEADS + RAG) LOADED'
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

// 3. ابزارهای پایه (لید جنریشن)
const baseTools = [
  {
    type: 'function',
    function: {
      name: 'save_lead_info',
      description:
        'Extract and save user contact information (Lead) when provided.',
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
      throw e;
    }
  },

  /**
   * افزودن سند به پایگاه دانش
   */
  addDocument: async (igAccountId, title, content) => {
    try {
      await azureService.ensureIndexExists();
      const { vector, usage } = await azureService.getEmbedding(content);
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
   * آنالیز لحن (Tone Cloning) 🎭
   * (این همان تابعی بود که جا افتاده بود)
   */
  analyzeTone: async (samples) => {
    try {
      const systemPrompt = `
      You are an expert Linguist. Analyze these Persian messages from a business owner.
      Extract their unique writing style, tone, emoji usage, and sentence structure.

      OUTPUT JSON ONLY:
      {
        "generatedSystemPrompt": "Write a prompt (in Persian) that instructs an AI to mimic this exact persona. Include details like: 'Use these specific catchphrases...', 'Use emojis like...', 'Be formal/informal...'"
      }
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
   * تحلیل هوشمند پیام (CRM Intelligence) 📊
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
   * جستجو و پاسخ هوشمند (RAG + Tools + Memory + Flows) 🤖
   */
  askAI: async (
    igAccountId,
    userQuery,
    systemInstruction = 'You are a helpful assistant.',
    senderData = {},
    aiConfig = {},
    history = [],
    availableFlows = []
  ) => {
    try {
      let totalUsage = 0;

      // 1. وکتور کردن سوال (هزینه دارد)
      const { vector, usage: embedUsage } = await azureService.getEmbedding(
        userQuery
      );
      totalUsage += embedUsage;

      // 2. جستجو در آژور سرچ
      const searchResults = await searchClient.search(userQuery, {
        vectorQueries: [
          { vector: vector, k: 5, fields: ['contentVector'], kind: 'vector' },
        ],
        filter: `ig_accountId eq '${igAccountId}'`,
        select: ['content', 'title'],
      });

      let context = '';
      for await (const result of searchResults.results) {
        context += `[Source: ${result.document.title}]\n${result.document.content}\n---\n`;
      }

      if (!context) console.log('⚠️ No context found in KB.');

      const strictMode = aiConfig.strictMode ?? false;
      const temperature = aiConfig.creativity ?? 0.5;

      // اضافه کردن ابزار اجرای فلو به لیست ابزارها
      let dynamicTools = [...baseTools];
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
                  description: 'The name of the flow to trigger',
                },
              },
              required: ['flow_name'],
            },
          },
        });
      }

      let promptLogic = strictMode
        ? "Answer ONLY using the provided Context. If not found, say 'اطلاعاتی ندارم'."
        : 'Use Context as primary source. Use general knowledge if needed.';

      const finalSystemPrompt = `${systemInstruction}\n\n${promptLogic}\n\nCONTEXT FROM KNOWLEDGE BASE:\n${context}\n\nIMPORTANT: If user gives phone number, ALWAYS use 'save_lead_info'.`;

      const messages = [
        { role: 'system', content: finalSystemPrompt },
        ...history,
        { role: 'user', content: userQuery },
      ];

      // 3. درخواست به GPT
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

      // 4. هندل کردن ابزارها
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const args = JSON.parse(toolCall.function.arguments);

        // الف: لید جنریشن
        if (toolCall.function.name === 'save_lead_info') {
          console.log('🎣 AI Lead Capture:', args);
          try {
            await Lead.create({
              ig_accountId,
              phone: args.phone,
              extracted_name: args.name,
              interest_product: args.product,
              ...senderData,
            });
          } catch (e) {
            console.log('Lead DB Error:', e.message);
          }

          // ادامه مکالمه
          messages.push(message);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ success: true, message: 'Lead Saved' }),
          });

          const finalRes = await openai.chat.completions.create({
            model: chatDeployment,
            messages,
          });
          totalUsage += finalRes.usage.total_tokens;

          return {
            content: finalRes.choices[0].message.content,
            usage: { total_tokens: totalUsage },
            leadCaptured: true,
          };
        }

        // ب: اجرای فلو (Flow Triggering)
        else if (toolCall.function.name === 'trigger_flow') {
          console.log(`🤖 AI Triggering Flow: ${args.flow_name}`);
          return {
            action: 'trigger_flow',
            flowName: args.flow_name,
            usage: { total_tokens: totalUsage },
          };
        }
      }

      return {
        content: message.content,
        usage: { total_tokens: totalUsage },
        leadCaptured: false,
      };
    } catch (e) {
      console.error('AI Generation Error:', e.message);
      return null;
    }
  },

  /**
   * چت ساده (برای دمو)
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
