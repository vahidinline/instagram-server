const axios = require('axios');

const wooService = {
  // 1. جستجوی محصول (قبلی - بدون تغییر)
  searchProducts: async (connection, query) => {
    try {
      const siteUrl = connection.siteUrl.replace(/\/$/, '');
      const response = await axios.get(`${siteUrl}/wp-json/wc/v3/products`, {
        params: {
          search: query,
          status: 'publish',
          per_page: 5,
        },
        auth: {
          username: connection.consumerKey,
          password: connection.consumerSecret,
        },
      });

      if (response.data.length === 0) return 'هیچ محصولی با این نام یافت نشد.';

      return response.data.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        stock_status: p.stock_status, // instock یا outofstock
        stock_quantity: p.stock_quantity,
        permalink: p.permalink,
        image: p.images[0]?.src || '',
        description: p.short_description
          .replace(/<[^>]*>?/gm, '')
          .substring(0, 100),
      }));
    } catch (error) {
      console.error('Woo Search Error:', error.message);
      return 'خطا در ارتباط با فروشگاه.';
    }
  },

  // 2. پیگیری سفارش (قبلی - بدون تغییر)
  getOrderStatus: async (connection, orderId) => {
    // ... (کد قبلی اینجا باشد)
    try {
      const siteUrl = connection.siteUrl.replace(/\/$/, '');
      const response = await axios.get(
        `${siteUrl}/wp-json/wc/v3/orders/${orderId}`,
        {
          auth: {
            username: connection.consumerKey,
            password: connection.consumerSecret,
          },
        }
      );
      const order = response.data;
      return { status: order.status, total: order.total, id: order.id };
    } catch (e) {
      return 'سفارش یافت نشد.';
    }
  },

  // 3. ثبت سفارش جدید (✅ جدید)
  createOrder: async (connection, orderData) => {
    try {
      const siteUrl = connection.siteUrl.replace(/\/$/, '');

      const payload = {
        payment_method: 'cod', // یا درگاه آنلاین
        payment_method_title: 'پرداخت آنلاین / کارت به کارت',
        set_paid: false,
        billing: {
          first_name: orderData.firstName || 'کاربر',
          last_name: orderData.lastName || 'مهمان',
          address_1: orderData.address || '',
          phone: orderData.phone,
          email: orderData.email || 'guest@example.com', // ایمیل اجباری است
        },
        line_items: [
          {
            product_id: orderData.productId,
            quantity: orderData.quantity || 1,
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

      // لینک پرداخت (Checkout Key)
      // در ووکامرس استاندارد، لینک پرداخت معمولا به این صورت است:
      const checkoutUrl = `${siteUrl}/checkout/order-pay/${order.id}/?pay_for_order=true&key=${order.order_key}`;

      return {
        success: true,
        order_id: order.id,
        total: order.total,
        payment_url: checkoutUrl,
        message: 'سفارش با موفقیت ثبت شد.',
      };
    } catch (error) {
      console.error(
        'Woo Create Order Error:',
        error.response?.data || error.message
      );
      return {
        success: false,
        message: 'خطا در ثبت سفارش. لطفا ورودی‌ها را چک کنید.',
      };
    }
  },
};

module.exports = wooService;
