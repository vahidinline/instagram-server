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
          ? p.short_description.replace(/<[^>]*>?/gm, '').substring(0, 100)
          : '',
      }));
    } catch (error) {
      console.error('Woo Search Error:', error.message);
      return [];
    }
  },

  // اطلاعات محصول تکی
  getProductById: async (connection, productId) => {
    try {
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
      return {
        name: response.data.name,
        price: response.data.price,
        stock: response.data.stock_quantity,
      };
    } catch (e) {
      return null;
    }
  },

  // ثبت سفارش واقعی
  createOrder: async (connection, orderData) => {
    try {
      const siteUrl = connection.siteUrl.replace(/\/$/, '');

      // جدا کردن نام و نام خانوادگی (ساده)
      const names = (orderData.fullName || 'کاربر مهمان').split(' ');
      const firstName = names[0];
      const lastName = names.length > 1 ? names.slice(1).join(' ') : 'مهمان';

      const payload = {
        payment_method: 'bacs', // کارت به کارت (یا هر چی که دیفالت هست)
        payment_method_title: 'پرداخت آنلاین',
        set_paid: false,
        billing: {
          first_name: firstName,
          last_name: lastName,
          address_1: orderData.address,
          city: 'Tehran', // فعلا هاردکد، بعدا میشه از ادرس استخراج کرد
          phone: orderData.phone,
          email: 'guest@generated.com', // ووکامرس ایمیل میخواد، فیک میزنیم اگر کاربر نداد
        },
        line_items: [
          {
            product_id: orderData.productId,
            quantity: 1,
          },
        ],
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

      const order = response.data;

      // ساخت لینک پرداخت (استاندارد ووکامرس)
      // این لینک کاربر را مستقیم به صفحه پرداخت بانک میبرد (اگر درگاه نصب باشد)
      const payLink =
        order.payment_url ||
        `${siteUrl}/checkout/order-pay/${order.id}/?pay_for_order=true&key=${order.order_key}`;

      return {
        success: true,
        order_id: order.id,
        total: order.total,
        payment_url: payLink,
        message: 'سفارش ثبت شد! لینک پرداخت ایجاد گردید.',
      };
    } catch (error) {
      console.error('Woo Order Error:', error.response?.data || error.message);
      return { success: false, message: 'خطا در ثبت سفارش در سایت.' };
    }
  },
};

module.exports = wooService;
