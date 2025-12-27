const { AzureOpenAI } = require('openai');
const wooService = require('../wooService');
const toolsDefinition = require('./tools');
const Lead = require('../../models/Lead');

const openai = new AzureOpenAI({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiKey: process.env.AZURE_OPENAI_KEY,
  apiVersion: '2024-05-01-preview',
});

const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_CHAT;

const aiCore = {
  ask: async (params) => {
    try {
      const { userText, systemPrompt, history, connection, contextData } =
        params;

      // تزریق کانتکست صفحه (اطلاعات محصولی که کاربر در حال دیدن آن است)
      let finalSystemPrompt = systemPrompt;
      if (contextData?.productInfo) {
        finalSystemPrompt += `\n\n[CONTEXT] User is currently looking at product page:
        Name: ${contextData.productInfo.name}
        Price: ${contextData.productInfo.price}
        Stock: ${contextData.productInfo.stock}
        (You know this product implicitly, don't ask user "what product?")`;
      }

      const messages = [
        { role: 'system', content: finalSystemPrompt },
        ...history,
        { role: 'user', content: userText },
      ];

      const response = await openai.chat.completions.create({
        model: deployment,
        messages: messages,
        temperature: 0.5,
        tools: toolsDefinition,
        tool_choice: 'auto',
      });

      const message = response.choices[0].message;

      // هندل کردن ابزارها
      if (message.tool_calls) {
        const toolCall = message.tool_calls[0];
        const args = JSON.parse(toolCall.function.arguments);
        let result = null;
        let resultType = 'text';

        if (toolCall.function.name === 'check_product_stock') {
          console.log('🛍️ AI Searching:', args.query);
          const products = await wooService.searchProducts(
            connection,
            args.query
          );
          // اگر محصول پیدا شد، دیتای خام را برگردان تا هندلر وب آن را کاروسل کند
          if (products.length > 0) {
            result = JSON.stringify(products);
            resultType = 'products_list'; // فلگ اختصاصی
          } else {
            result = 'محصولی یافت نشد.';
          }
        } else if (toolCall.function.name === 'create_order') {
          const order = await wooService.createOrder(connection, args);
          result = JSON.stringify(order);
        } else if (toolCall.function.name === 'save_lead') {
          await Lead.create({ ig_accountId: connection._id, ...args });
          result = 'اطلاعات تماس ذخیره شد.';
        }

        // اگر نوع نتیجه لیست محصول بود، دیگر به GPT برنمی‌گردیم تا عکس‌ها خراب نشوند
        // مستقیم به هندلر برمی‌گردانیم
        if (resultType === 'products_list') {
          return { type: 'products', data: JSON.parse(result) };
        }

        // بازگشت نتیجه ابزار به GPT برای تولید متن نهایی
        messages.push(message);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });

        const finalRes = await openai.chat.completions.create({
          model: deployment,
          messages: messages,
        });

        return { type: 'text', content: finalRes.choices[0].message.content };
      }

      return { type: 'text', content: message.content };
    } catch (e) {
      console.error('AI Core Error:', e.message);
      return { type: 'text', content: 'خطا در ارتباط با هوش مصنوعی.' };
    }
  },
};

module.exports = aiCore;
