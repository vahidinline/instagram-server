const { AzureOpenAI } = require('openai');
const { AzureKeyCredential } = require('@azure/core-auth');
const { SearchIndexClient, SearchClient } = require('@azure/search-documents');
const crypto = require('crypto');
const wooService = require('../wooService');
const toolsDefinition = require('./tools');
const Lead = require('../../models/Lead');
const AnalyticsEvent = require('../../models/AnalyticsEvent'); // ✅ برای ثبت آمار قیف فروش

console.log(
  '🟢 AI CORE v4.0 - FULL (RAG + Shop + Tools + Analytics + FilterGuard)'
);

// --- CONFIGURATION ---
const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_KEY;
const apiVersion = '2024-05-01-preview';
// نام‌های Deployment در آژور
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
  // بخش ۲: ابزارهای تحلیل (CRM و Tone Wizard)
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
      return 'تو یک دستیار هوشمند و مودب هستی.';
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
  // بخش ۳: سیستم ثبت آمار (Analytics Helper)
  // ============================================================

  trackEvent: async (eventType, contextData, metaData = {}) => {
    try {
      // اگر اطلاعات کانال موجود نیست، ثبت نکن
      if (!contextData || !contextData.channelId) return;

      await AnalyticsEvent.create({
        ig_accountId: contextData.channelId,
        persona_id: contextData.personaId || null, // ثبت پرسونای فعال
        user_id: contextData.senderId || 'unknown',
        eventType,
        metaData,
      });
      // console.log(`📊 Event Tracked: ${eventType}`);
    } catch (e) {
      console.error('Analytics Tracking Error:', e.message);
    }
  },

  // ============================================================
  // بخش ۴: مغز اصلی چت (Chat & Tools Logic)
  // ============================================================

  ask: async (params) => {
    try {
      const { userText, systemPrompt, history, connection, contextData } =
        params;
      const igAccountId = connection._id || connection.ig_userId;

      // آماده‌سازی کانتکست برای ثبت آمار
      const analyticsContext = {
        channelId: igAccountId,
        personaId: contextData?.personaId,
        senderId: contextData?.senderId,
      };

      // الف) جستجو در پایگاه دانش (RAG)
      let ragContext = '';
      if (userText && userText.length > 5) {
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

      // ج) درخواست اول به مدل (با مدیریت خطای فیلتر محتوا)
      let response;
      try {
        response = await openai.chat.completions.create({
          model: chatDeployment,
          messages: messages,
          temperature: 0.2, // دما پایین برای دقت در ابزارها
          tools: toolsDefinition,
          tool_choice: 'auto',
        });
      } catch (apiError) {
        // هندل کردن خطای 400 (Content Filter)
        if (
          apiError.status === 400 &&
          apiError.message &&
          apiError.message.includes('content management policy')
        ) {
          console.warn('⚠️ Azure Content Filter Triggered on Request 1');
          return {
            type: 'text',
            content:
              'متاسفانه پیام شما توسط سیستم امنیتی شناسایی شد. لطفاً با بیانی دیگر تلاش کنید.',
          };
        }
        throw apiError; // خطاهای دیگر را پرتاب کن
      }

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
        let isOptionChip = false;
        let optionData = null;

        // اجرای تمام ابزارها (Loop استاندارد)
        for (const toolCall of responseMessage.tool_calls) {
          const fnName = toolCall.function.name;
          let args = {};
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (parseErr) {
            console.error('JSON Parse Error:', parseErr);
          }

          let toolResult = 'Done';
          console.log(`🔹 Executing: ${fnName}`);

          try {
            // --- 1. Check Stock ---
            if (fnName === 'check_product_stock') {
              // ثبت آمار: سرچ محصول
              await aiCore.trackEvent('PRODUCT_SEARCH', analyticsContext, {
                query: args.query,
              });

              const products = await wooService.searchProducts(
                connection,
                args.query
              );
              if (products.length > 0) {
                toolResult = JSON.stringify(products);
                isProductList = true;
                productData = products;
                // ثبت آمار: محصول پیدا شد
                await aiCore.trackEvent('PRODUCT_FOUND', analyticsContext, {
                  count: products.length,
                });
              } else {
                toolResult = 'No products found.';
              }
            }
            // --- 2. Create Order ---
            else if (fnName === 'create_order') {
              // پشتیبانی از هر دو فرمت (آرایه یا تکی)
              let orderPayload = { ...args };

              // اگر هوش مصنوعی فرمت قدیمی فرستاد، تبدیل به آرایه کن
              if (!orderPayload.items && orderPayload.productId) {
                orderPayload.items = [
                  {
                    productId: parseInt(orderPayload.productId),
                    quantity: parseInt(orderPayload.quantity) || 1,
                  },
                ];
              }

              const order = await wooService.createOrder(
                connection,
                orderPayload
              );

              if (order.success) {
                // ✅ ثبت آمار: لینک ساخته شد (مهمترین KPI)
                await aiCore.trackEvent('LINK_GENERATED', analyticsContext, {
                  orderId: order.order_id,
                  amount: order.total,
                });
              }

              toolResult = JSON.stringify(order);
            }
            // --- 3. Save Lead ---
            else if (fnName === 'save_lead_info' || fnName === 'save_lead') {
              const leadData = {
                ig_accountId: connection._id,
                platform: contextData?.platform || 'web',
                sender_id: contextData?.senderId || 'unknown',
                phone: args.phone,
                extracted_name: args.name,
                interest_product: args.productName,
              };
              await Lead.create(leadData);

              // ثبت آمار: لید گرفته شد
              await aiCore.trackEvent('LEAD_CAPTURED', analyticsContext);

              toolResult = 'Lead saved successfully.';
            }
            // --- 4. Ask Options (Chips) ---
            else if (fnName === 'ask_multiple_choice') {
              isOptionChip = true;
              optionData = {
                type: 'options',
                question: args.question,
                choices: args.options,
              };
              toolResult = 'Options displayed to user.';
            }
          } catch (err) {
            console.error(`❌ Tool Execution Error (${fnName}):`, err.message);
            toolResult = JSON.stringify({
              error: 'Failed',
              details: err.message,
            });
          }

          // ✅ اضافه کردن نتیجه ابزار به تاریخچه با ID صحیح
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          });
        }

        // 1. اگر ابزار دکمه‌ای بود
        if (isOptionChip && optionData) {
          return optionData;
        }

        // 2. اگر خروجی کاروسل محصول بود (و فقط همین یک ابزار صدا شده بود)
        if (
          isProductList &&
          productData &&
          responseMessage.tool_calls.length === 1
        ) {
          return { type: 'products', data: productData };
        }

        // ه) درخواست دوم برای پاسخ نهایی متنی (با هندلینگ خطای فیلتر)
        try {
          const finalResponse = await openai.chat.completions.create({
            model: chatDeployment, // نام متغیر صحیح
            messages: messages,
          });
          return {
            type: 'text',
            content: finalResponse.choices[0].message.content,
          };
        } catch (apiError) {
          if (
            apiError.status === 400 &&
            apiError.message &&
            apiError.message.includes('content management policy')
          ) {
            console.warn('⚠️ Azure Content Filter Triggered on Request 2');
            const lastMsg = messages[messages.length - 1];
            // اگر سفارش ثبت شده بود اما متن فیلتر شد، پیام موفقیت دستی بده
            if (
              lastMsg.role === 'tool' &&
              lastMsg.content.includes('"success":true')
            ) {
              return {
                type: 'text',
                content:
                  'سفارش شما با موفقیت ثبت شد. لطفاً برای پرداخت روی لینک‌های ارسال شده کلیک کنید.',
              };
            }
            return {
              type: 'text',
              content: 'متاسفانه در تولید پاسخ نهایی خطایی رخ داد.',
            };
          }
          throw apiError;
        }
      }

      // اگر ابزاری صدا زده نشد
      return { type: 'text', content: responseMessage.content };
    } catch (e) {
      console.error('❌ AI Core Critical Error:', e.message);
      return {
        type: 'text',
        content: 'متاسفانه خطایی در سرور رخ داد. لطفا دوباره تلاش کنید.',
      };
    }
  },
};

module.exports = aiCore;
