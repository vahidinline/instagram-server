const tools = [
  // 1. استعلام موجودی
  {
    type: 'function',
    function: {
      name: 'check_product_stock',
      description:
        'Search for products via WooCommerce API to check availability and price.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Product name or keyword (e.g. کفش نایک)',
          },
        },
        required: ['query'],
      },
    },
  },

  // 2. ثبت سفارش (با پارامترهای اجباری)
  {
    type: 'function',
    function: {
      name: 'create_order',
      description:
        'Create a pending order in WooCommerce and generate payment link.',
      parameters: {
        type: 'object',
        properties: {
          productId: {
            type: 'integer',
            description:
              'The numeric Product ID found from check_product_stock',
          },
          fullName: {
            type: 'string',
            description: 'Customer full name extracted from message',
          },
          phone: {
            type: 'string',
            description: 'Customer valid mobile number (e.g. 0912...)',
          },
          address: { type: 'string', description: 'Full shipping address' },
        },
        required: ['productId', 'fullName', 'phone', 'address'], // این خط حیاتی است
      },
    },
  },

  // 3. ثبت لید (وقتی کالا نیست)
  {
    type: 'function',
    function: {
      name: 'save_lead',
      description: 'Save customer contact info when product is OUT OF STOCK.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
          name: { type: 'string' },
          productName: {
            type: 'string',
            description: 'Name of the product user wanted',
          },
        },
        required: ['phone'],
      },
    },
  },
];

module.exports = tools;
