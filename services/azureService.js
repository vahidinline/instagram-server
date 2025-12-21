const { AzureOpenAI } = require('openai');
const { AzureKeyCredential } = require('@azure/core-auth');
const { SearchIndexClient, SearchClient } = require('@azure/search-documents');
const crypto = require('crypto');
const Lead = require('../models/Lead');

console.log('🟢 AZURE SERVICE v10 - AGENTIC MODE (FLOW TRIGGERING) LOADED');

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

// 3. ابزارهای پایه (لید)
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
          name: { type: 'string', description: "User's name" },
          product: { type: 'string', description: 'Interest product' },
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
          content,
          title,
          ig_accountId: igAccountId,
          contentVector: vector,
        },
      ];
      await searchClient.uploadDocuments(documents);
      console.log(`✅ Document indexed for ${igAccountId}`);
      return docId;
    } catch (e) {
      console.error('Indexing Error:', e.message);
      return false;
    }
  },

  deleteDocument: async (docId) => {
    try {
      const documents = [{ id: docId, '@search.action': 'delete' }];
      await searchClient.uploadDocuments(documents);
      return true;
    } catch (e) {
      return false;
    }
  },

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
      return JSON.parse(response.choices[0].message.content);
    } catch (e) {
      return { sentiment: 'neutral', tags: [], score: 0, new_stage: null };
    }
  },

  /**
   * جستجو و پاسخ هوشمند (با قابلیت اجرای فلو)
   */
  askAI: async (
    igAccountId,
    userQuery,
    systemInstruction,
    senderData = {},
    aiConfig = {},
    history = [],
    availableFlows = []
  ) => {
    try {
      const strictMode = aiConfig.strictMode ?? false;
      const temperature = aiConfig.creativity ?? 0.5;

      // 1. آماده‌سازی ابزارها (اضافه کردن فلوها)
      let dynamicTools = [...baseTools];
      if (availableFlows.length > 0) {
        dynamicTools.push({
          type: 'function',
          function: {
            name: 'trigger_flow',
            description: `Use this tool ONLY if the user asks for something that matches one of these flows: [${availableFlows
              .map((f) => f.name)
              .join(', ')}]`,
            parameters: {
              type: 'object',
              properties: {
                flow_name: {
                  type: 'string',
                  enum: availableFlows.map((f) => f.name),
                  description: 'The exact name of the flow to trigger',
                },
              },
              required: ['flow_name'],
            },
          },
        });
      }

      // 2. RAG
      const queryVector = await azureService.getEmbedding(userQuery);
      const searchResults = await searchClient.search(userQuery, {
        vectorQueries: [
          {
            vector: queryVector,
            k: 5,
            fields: ['contentVector'],
            kind: 'vector',
          },
        ],
        filter: `ig_accountId eq '${igAccountId}'`,
        select: ['content', 'title'],
      });

      let context = '';
      for await (const result of searchResults.results)
        context += result.document.content + '\n---\n';

      let promptLogic = strictMode
        ? 'Answer ONLY using the provided Context.'
        : 'Use Context as primary source. Use general knowledge if needed.';

      const finalSystemPrompt = `${systemInstruction}\n\n${promptLogic}\n\nCONTEXT:\n${context}\n\nIMPORTANT: If user gives phone, use 'save_lead_info'. If user asks for specific content available in flows, use 'trigger_flow'.`;

      const messages = [
        { role: 'system', content: finalSystemPrompt },
        ...history,
        { role: 'user', content: userQuery },
      ];

      // 3. درخواست GPT
      const response = await openai.chat.completions.create({
        model: chatDeployment,
        messages: messages,
        temperature: temperature,
        tools: dynamicTools,
        tool_choice: 'auto',
      });

      const choice = response.choices[0];
      const message = choice.message;

      // 4. هندل کردن ابزارها
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const args = JSON.parse(toolCall.function.arguments);

        // الف: لید
        if (toolCall.function.name === 'save_lead_info') {
          try {
            await Lead.create({
              ig_accountId,
              phone: args.phone,
              ...senderData,
            });
          } catch (e) {}
          messages.push(message);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ success: true }),
          });
          const finalRes = await openai.chat.completions.create({
            model: chatDeployment,
            messages,
          });
          return {
            content: finalRes.choices[0].message.content,
            usage: finalRes.usage,
            leadCaptured: true,
          };
        }

        // ب: اجرای فلو (جدید)
        else if (toolCall.function.name === 'trigger_flow') {
          console.log(`🤖 AI Triggering Flow: ${args.flow_name}`);
          return {
            action: 'trigger_flow',
            flowName: args.flow_name,
            usage: response.usage,
          };
        }
      }

      return {
        content: message.content,
        usage: response.usage,
        leadCaptured: false,
      };
    } catch (e) {
      console.error('AI Error:', e.message);
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
      return 'Error in demo chat.';
    }
  },
};

module.exports = azureService;
