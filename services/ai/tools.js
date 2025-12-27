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
          query: { type: 'string', description: 'Product name or keyword' },
        },
        required: ['query'],
      },
    },
  },

  // 2. ثبت سفارش (Strict Array Mode)
  {
    type: 'function',
    function: {
      name: 'create_order',
      description: 'Create a SINGLE order containing one or multiple items.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'List of products to purchase',
            items: {
              type: 'object',
              properties: {
                productId: {
                  type: 'integer',
                  description: 'The numeric Product ID',
                },
                quantity: {
                  type: 'integer',
                  description: 'Quantity for this specific product',
                },
              },
              required: ['productId', 'quantity'],
            },
          },
          fullName: { type: 'string', description: 'Customer full name' },
          phone: {
            type: 'string',
            description: 'Customer valid mobile number',
          },
          address: { type: 'string', description: 'Full shipping address' },
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
      description: 'Save customer contact info when product is OUT OF STOCK.',
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
];

module.exports = tools;
