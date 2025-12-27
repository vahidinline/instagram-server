const { AzureOpenAI } = require('openai');
const { AzureKeyCredential } = require('@azure/core-auth');
const { SearchIndexClient, SearchClient } = require('@azure/search-documents');
const crypto = require('crypto');
const wooService = require('../wooService');
const toolsDefinition = require('./tools');
const Lead = require('../../models/Lead');

console.log('🟢 AI CORE v2.0 - Loaded (RAG + Shop + Tools)');

// --- CONFIGURATION ---
const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_KEY;
const apiVersion = '2024-05-01-preview';
const chatDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_CHAT;
const embeddingDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_EMBEDDING;

const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
const searchKey = process.env.AZURE_SEARCH_KEY;
const indexName = process.env.AZURE_SEARCH_INDEX_NAME || 'knowledge-base-index';

// 1. ساخت کلاینت‌های OpenAI و Search
const openai = new AzureOpenAI({ endpoint, apiKey, apiVersion });
const searchIndexClient = new SearchIndexClient(
  searchEndpoint,
  new AzureKeyCredential(searchKey)
);
const searchClient = new SearchClient(
  searchEndpoint,
  indexName,
  new AzureKeyCredential(searchKey)
);

const aiCore = {
  // ============================================================
  // بخش ۱: مدیریت دانش و RAG (وکتور و سرچ)
  // ============================================================

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
      return {
        vector: response.data[0].embedding,
        usage: response.usage.total_tokens,
      };
    } catch (e) {
      console.error('Embedding Error:', e.message);
      return { vector: [], usage: 0 };
    }
  },

  addDocument: async (igAccountId, title, content) => {
    try {
      await aiCore.ensureIndexExists();
      const { vector, usage } = await aiCore.getEmbedding(content);
      if (!vector.length) return false;

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
      return docId;
    } catch (e) {
      console.error('Indexing Error:', e.message);
      return false;
    }
  },

  deleteDocument: async (docId) => {
    try {
      await searchClient.uploadDocuments([
        { id: docId, '@search.action': 'delete' },
      ]);
      return true;
    } catch (e) {
      return false;
    }
  },

  // ============================================================
  // بخش ۲: ابزارهای تحلیل (CRM و لحن)
  // ============================================================

  analyzeTone: async (samples) => {
    try {
      const systemPrompt = `You are an expert Linguist. Analyze these Persian messages. Extract unique writing style, tone, and emoji usage. OUTPUT JSON: { "generatedSystemPrompt": "Write a prompt..." }`;
      const userContent = `Samples:\n${samples
        .map((s, i) => `${i + 1}. ${s}`)
        .join('\n')}`;

      const response = await openai.chat.completions.create({
        model: chatDeployment,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
      });
      return JSON.parse(response.choices[0].message.content)
        .generatedSystemPrompt;
    } catch (e) {
      return 'تو یک دستیار هوشمند هستی.';
    }
  },

  analyzeMessage: async (text, currentStage = 'lead') => {
    try {
      const systemPrompt = `Analyze this Persian message for CRM. Current Stage: ${currentStage}. Output JSON: { "sentiment": "neutral", "tags": [], "score": 0, "new_stage": null }`;
      const response = await openai.chat.completions.create({
        model: chatDeployment,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
      });
      return { result: JSON.parse(response.choices[0].message.content) };
    } catch (e) {
      return { result: { sentiment: 'neutral', tags: [], score: 0 } };
    }
  },

  // ============================================================
  // بخش ۳: مغز اصلی چت (Chat & Tools Logic)
  // ============================================================

  ask: async (params) => {
    try {
      const { userText, systemPrompt, history, connection, contextData } =
        params;
      const igAccountId = connection._id || connection.ig_userId;

      // الف) جستجو در پایگاه دانش (RAG)
      let ragContext = '';
      if (userText.length > 5) {
        const { vector } = await aiCore.getEmbedding(userText);
        if (vector.length > 0) {
          try {
            const searchResults = await searchClient.search(userText, {
              vectorQueries: [
                { vector, k: 3, fields: ['contentVector'], kind: 'vector' },
              ],
              filter: `ig_accountId eq '${igAccountId}'`,
              select: ['content', 'title'],
            });
            for await (const r of searchResults.results)
              ragContext += `\n[Info: ${r.document.title}]\n${r.document.content}`;
          } catch (e) {
            /* Ignore Search Error */
          }
        }
      }

      // ب) ترکیب پرامپت‌ها
      const fullSystemPrompt = `${systemPrompt}\n\n[KNOWLEDGE BASE]\n${
        ragContext || 'No extra info.'
      }`;

      const messages = [
        { role: 'system', content: fullSystemPrompt },
        ...history,
        { role: 'user', content: userText },
      ];

      // ج) درخواست اول به مدل
      const response = await openai.chat.completions.create({
        model: chatDeployment,
        messages: messages,
        temperature: 0.3,
        tools: toolsDefinition,
        tool_choice: 'auto',
      });

      const responseMessage = response.choices[0].message;

      // د) بررسی فراخوانی ابزار (Tool Calls)
      if (responseMessage.tool_calls) {
        // ✅ نکته حیاتی: اضافه کردن پیام مدل به تاریخچه
        messages.push(responseMessage);

        console.log(
          `🛠️ AI Triggered ${responseMessage.tool_calls.length} Tool(s)`
        );

        let isProductList = false;
        let productData = null;

        // اجرای تمام ابزارها (Loop)
        for (const toolCall of responseMessage.tool_calls) {
          const fnName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          let toolResult = 'Done';

          console.log(`🔹 Executing: ${fnName}`);

          try {
            if (fnName === 'check_product_stock') {
              const products = await wooService.searchProducts(
                connection,
                args.query
              );
              if (products.length > 0) {
                toolResult = JSON.stringify(products);
                isProductList = true;
                productData = products;
              } else {
                toolResult = 'محصولی یافت نشد.';
              }
            } else if (fnName === 'create_order') {
              args.productId = parseInt(args.productId);
              args.quantity = parseInt(args.quantity) || 1; // فیکس کردن تعداد
              const order = await wooService.createOrder(connection, args);
              toolResult = JSON.stringify(order);
            } else if (fnName === 'save_lead_info' || fnName === 'save_lead') {
              const leadData = {
                ig_accountId: connection._id,
                platform: contextData?.platform || 'web',
                sender_id: contextData?.senderId || 'unknown',
                phone: args.phone,
                extracted_name: args.name,
                interest_product: args.productName,
              };
              await Lead.create(leadData);
              toolResult = 'Lead saved successfully.';
            }
          } catch (err) {
            console.error(`❌ Tool Execution Error (${fnName}):`, err.message);
            toolResult = JSON.stringify({
              error: 'Failed',
              details: err.message,
            });
          }

          // ✅ اضافه کردن نتیجه ابزار به تاریخچه
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          });
        }

        // اگر خروجی کاروسل محصول بود، نیازی به متن نیست
        if (isProductList && productData) {
          return { type: 'products', data: productData };
        }

        // ه) درخواست دوم برای پاسخ نهایی متنی
        const finalResponse = await openai.chat.completions.create({
          model: deployment,
          messages: messages,
        });

        return {
          type: 'text',
          content: finalResponse.choices[0].message.content,
        };
      }

      // اگر ابزاری صدا زده نشد
      return { type: 'text', content: responseMessage.content };
    } catch (e) {
      console.error('❌ AI Core Error:', e.message);
      return {
        type: 'text',
        content: 'متاسفانه خطایی رخ داد. لطفا دوباره تلاش کنید.',
      };
    }
  },
};

module.exports = aiCore;
