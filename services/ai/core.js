const { AzureOpenAI } = require('openai');
const wooService = require('../wooService');
const Lead = require('../../models/Lead');

// --- 1. تعریف ابزارها (Tools Definition) ---
// این بخش به هوش مصنوعی می‌گوید چه قابلیت‌هایی دارد
const toolsDefinition = [
  {
    type: 'function',
    function: {
      name: 'check_product_stock',
      description:
        'Search for products in the WooCommerce store to check details, price, and stock.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: "Product name (e.g. 'کفش')" },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_order',
      description:
        'Create a pending order in WooCommerce when user wants to buy.',
      parameters: {
        type: 'object',
        properties: {
          productId: {
            type: 'integer',
            description: 'Product ID found via check_product_stock',
          },
          quantity: { type: 'integer', default: 1 },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          phone: {
            type: 'string',
            description: 'User phone number (Essential)',
          },
          address: { type: 'string', description: 'Full address' },
        },
        required: ['productId', 'phone', 'address'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_lead_info',
      description:
        'Save user contact info when product is out of stock or user requests notification.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Phone number' },
          name: { type: 'string' },
          product: { type: 'string', description: 'Product of interest' },
        },
        required: ['phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'track_order',
      description: 'Check status of an existing order.',
      parameters: {
        type: 'object',
        properties: { order_id: { type: 'string' } },
        required: ['order_id'],
      },
    },
  },
];

// --- 2. کانفیگ کلاینت ---
const openai = new AzureOpenAI({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiKey: process.env.AZURE_OPENAI_KEY,
  apiVersion: '2024-05-01-preview',
});
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_CHAT;

// --- 3. هسته اصلی ---
const aiCore = {
  /**
   * تابع اصلی پرسش و پاسخ
   * @param {Object} params - شامل userText, systemPrompt, history, connection, contextData
   */
  ask: async (params) => {
    try {
      const { userText, systemPrompt, history, connection, contextData } =
        params;

      // الف) تزریق کانتکست صفحه (Product Awareness)
      // اگر کاربر در صفحه محصول باشد، اطلاعات آن محصول به پرامپت اضافه می‌شود
      let finalSystemPrompt = systemPrompt;
      if (contextData?.productInfo) {
        finalSystemPrompt += `
        \n[CURRENT CONTEXT]
        User is currently looking at this product page:
        - Name: ${contextData.productInfo.name}
        - Price: ${contextData.productInfo.price}
        - Stock: ${contextData.productInfo.stock}
        (You implicitly know this. Don't ask "which product?". If stock > 0, suggest buying this.)
        `;
      }

      const messages = [
        { role: 'system', content: finalSystemPrompt },
        ...history,
        { role: 'user', content: userText },
      ];

      // ب) ارسال درخواست به GPT
      const response = await openai.chat.completions.create({
        model: deployment,
        messages: messages,
        temperature: 0.5,
        tools: toolsDefinition,
        tool_choice: 'auto',
      });

      const message = response.choices[0].message;

      // ج) هندل کردن ابزارها (Tool Calling)
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const args = JSON.parse(toolCall.function.arguments);
        let result = null;
        let resultType = 'text'; // text | products_list

        console.log(`🛠️ AI Executing Tool: ${toolCall.function.name}`);

        // --- ابزار ۱: جستجوی محصول ---
        if (toolCall.function.name === 'check_product_stock') {
          const products = await wooService.searchProducts(
            connection,
            args.query
          );
          if (products.length > 0) {
            result = JSON.stringify(products);
            resultType = 'products_list'; // فلگ برای نمایش کاروسل در فرانت
          } else {
            result = 'محصولی یافت نشد.';
          }
        }

        // --- ابزار ۲: ثبت سفارش ---
        else if (toolCall.function.name === 'create_order') {
          const order = await wooService.createOrder(connection, args);
          result = JSON.stringify(order);
        }

        // --- ابزار ۳: ذخیره لید (Lead) ---
        else if (toolCall.function.name === 'save_lead_info') {
          try {
            // ✅ رفع باگ لید: پر کردن فیلدها بر اساس پلتفرم
            await Lead.create({
              ig_accountId: connection._id, // شناسه کانال (وب یا اینستا)
              platform: contextData.platform || 'web', // وب یا اینستا
              sender_id: contextData.senderId || 'unknown', // شناسه کاربر

              phone: args.phone,
              extracted_name: args.name,
              interest_product: args.product || contextData?.productInfo?.name, // استفاده از کانتکست اگر موجود بود

              // فیلدهای اینستاگرام (فقط در صورت وجود پر می‌شوند)
              instagram_username: contextData.username,
            });
            result =
              'شماره تماس با موفقیت در سیستم CRM ذخیره شد. به کاربر بگو همکاران ما تماس می‌گیرند.';
          } catch (err) {
            console.error('Lead Save DB Error:', err.message);
            result = 'خطا در ذخیره لید.';
          }
        }

        // --- ابزار ۴: پیگیری سفارش ---
        else if (toolCall.function.name === 'track_order') {
          result = await wooService.getOrderStatus(connection, args.order_id);
          if (typeof result === 'object') result = JSON.stringify(result);
        }

        // د) بازگشت نتیجه به سیستم

        // اگر نوع نتیجه "لیست محصولات" بود، مستقیم برگردان (برای نمایش گرافیکی)
        // وگرنه، نتیجه را به GPT بده تا متن نهایی بسازد
        if (resultType === 'products_list') {
          return { type: 'products', data: JSON.parse(result) };
        }

        // ادامه مکالمه با GPT (ارسال نتیجه ابزار)
        messages.push(message); // درخواست ابزار
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        }); // نتیجه ابزار

        const finalRes = await openai.chat.completions.create({
          model: deployment,
          messages: messages,
        });

        return { type: 'text', content: finalRes.choices[0].message.content };
      }

      // اگر هیچ ابزاری صدا زده نشد، همان متن معمولی را برگردان
      return { type: 'text', content: message.content };
    } catch (e) {
      console.error('❌ AI Core Error:', e.message);
      return {
        type: 'text',
        content:
          'متاسفانه در ارتباط با هوش مصنوعی خطایی رخ داد. لطفا دوباره تلاش کنید.',
      };
    }
  },
};

module.exports = aiCore;
