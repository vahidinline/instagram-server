const tools = [
  // 1. استعلام موجودی
  {
    type: 'function',
    function: {
      name: 'check_product_stock',
      description: 'Search for products via WooCommerce API.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },

  // 2. ثبت سفارش
  {
    type: 'function',
    function: {
      name: 'create_order',
      description: 'Create order with list of items.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                productId: { type: 'integer' },
                quantity: { type: 'integer' },
              },
              required: ['productId', 'quantity'],
            },
          },
          fullName: { type: 'string' },
          phone: { type: 'string' },
          address: { type: 'string' },
        },
        required: ['items', 'fullName', 'phone', 'address'],
      },
    },
  },

  // 3. ثبت لید
  {
    type: 'function',
    function: {
      name: 'save_lead',
      description: 'Save contact info when OUT OF STOCK.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
          name: { type: 'string' },
          productName: { type: 'string' },
        },
        required: ['phone'],
      },
    },
  },

  // ✅ 4. ابزار جدید: پرسش چند گزینه‌ای
  {
    type: 'function',
    function: {
      name: 'ask_multiple_choice',
      description:
        'Ask user to select from options (e.g. Size, Color, Quantity).',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question to ask (e.g. Which size?)',
          },
          options: {
            type: 'array',
            description: 'List of clickable options',
            items: { type: 'string' },
          },
        },
        required: ['question', 'options'],
      },
    },
  },
];

module.exports = tools;
