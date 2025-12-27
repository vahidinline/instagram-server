const axios = require('axios');

const wooService = {
  // جستجوی محصول
  searchProducts: async (connection, query) => {
    try {
      const siteUrl = connection.siteUrl.replace(/\/$/, '');
      const response = await axios.get(`${siteUrl}/wp-json/wc/v3/products`, {
        params: { search: query, status: 'publish', per_page: 5 },
        auth: {
          username: connection.consumerKey,
          password: connection.consumerSecret,
        },
      });

      if (response.data.length === 0) return [];

      return response.data.map((p) => ({
        id: p.id,
        title: p.name,
        subtitle: `${parseInt(p.price).toLocaleString()} تومان`,
        image_url: p.images[0]?.src || '',
        default_action_url: p.permalink,
        stock_quantity: p.stock_quantity,
        description: p.short_description
          .replace(/<[^>]*>?/gm, '')
          .substring(0, 150),
      }));
    } catch (error) {
      console.error('Woo Search Error:', error.message);
      return [];
    }
  },

  // دریافت اطلاعات یک محصول خاص (برای کانتکست صفحه)
  getProductById: async (connection, productId) => {
    try {
      if (!productId) return null;
      const siteUrl = connection.siteUrl.replace(/\/$/, '');
      const response = await axios.get(
        `${siteUrl}/wp-json/wc/v3/products/${productId}`,
        {
          auth: {
            username: connection.consumerKey,
            password: connection.consumerSecret,
          },
        }
      );
      const p = response.data;
      return {
        name: p.name,
        price: p.price,
        stock: p.stock_quantity,
        description: p.short_description.replace(/<[^>]*>?/gm, ''),
      };
    } catch (e) {
      return null;
    }
  },

  // ثبت سفارش
  createOrder: async (connection, orderData) => {
    try {
      const siteUrl = connection.siteUrl.replace(/\/$/, '');
      const payload = {
        payment_method: 'cod',
        payment_method_title: 'پرداخت امن',
        set_paid: false,
        billing: {
          first_name: 'کاربر',
          last_name: 'مهمان',
          address_1: orderData.address,
          phone: orderData.phone,
          email: 'guest@store.com',
        },
        line_items: [{ product_id: orderData.productId, quantity: 1 }],
      };

      const response = await axios.post(
        `${siteUrl}/wp-json/wc/v3/orders`,
        payload,
        {
          auth: {
            username: connection.consumerKey,
            password: connection.consumerSecret,
          },
        }
      );

      return {
        success: true,
        order_id: response.data.id,
        payment_url: `${siteUrl}/checkout/order-pay/${response.data.id}/?pay_for_order=true&key=${response.data.order_key}`,
        message: 'سفارش ثبت شد.',
      };
    } catch (error) {
      return { success: false, message: 'خطا در ثبت سفارش.' };
    }
  },
};

module.exports = wooService;
