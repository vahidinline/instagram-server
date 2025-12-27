const tools = [
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
  {
    type: 'function',
    function: {
      name: 'create_order',
      description: 'Create order in WooCommerce.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'integer' },
          phone: { type: 'string' },
          address: { type: 'string' },
        },
        required: ['productId', 'phone', 'address'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_lead',
      description: 'Save user contact info when product is out of stock.',
      parameters: {
        type: 'object',
        properties: { phone: { type: 'string' }, name: { type: 'string' } },
        required: ['phone'],
      },
    },
  },
];
module.exports = tools;
