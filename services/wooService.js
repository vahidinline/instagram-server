const axios = require('axios');

const wooService = {
  // جستجوی محصول (برای وقتی کاربر اسم محصول دیگری را میگوید)
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

  // ✅ دریافت اطلاعات دقیق محصول (شامل رنگ و سایز)
  getProductById: async (connection, productId) => {
    try {
      const siteUrl = connection.siteUrl.replace(/\/$/, '');
      const auth = {
        username: connection.consumerKey,
        password: connection.consumerSecret,
      };

      // 1. دریافت اطلاعات کلی محصول
      const response = await axios.get(
        `${siteUrl}/wp-json/wc/v3/products/${productId}`,
        { auth }
      );
      const p = response.data;

      let productData = {
        id: p.id,
        name: p.name,
        price: p.price,
        description: p.short_description.replace(/<[^>]*>?/gm, ''),
        stock_status: p.stock_status, // instock / outofstock
        type: p.type, // simple / variable
        variations_summary: '', // اینجا لیست موجودی‌ها را متنی می‌کنیم برای AI
      };

      // 2. اگر محصول متغیر است، باید لیست فرزندان (Variations) را بگیریم
      if (p.type === 'variable') {
        try {
          const varResponse = await axios.get(
            `${siteUrl}/wp-json/wc/v3/products/${productId}/variations`,
            {
              params: { per_page: 20 }, // چک کردن ۲۰ تنوع اول
              auth,
            }
          );

          // تبدیل لیست جیسون به یک متن قابل فهم برای هوش مصنوعی
          // مثال خروجی: "Color: Black, Size: 42 (In Stock) | Color: Red, Size: 42 (Out of Stock)"
          const summary = varResponse.data
            .map((v) => {
              const attrs = v.attributes
                .map((a) => `${a.name}: ${a.option}`)
                .join(', ');
              const stock =
                v.stock_quantity ||
                (v.stock_status === 'instock' ? 'موجود' : 'ناموجود');
              return `[${attrs} => Stock: ${stock}, Price: ${v.price}]`;
            })
            .join('\n');

          productData.variations_summary = summary;
        } catch (e) {
          console.log('Error fetching variations:', e.message);
        }
      }
      // اگر محصول ساده است
      else {
        productData.variations_summary = `Stock Quantity: ${
          p.stock_quantity || p.stock_status
        }`;
      }

      return productData;
    } catch (e) {
      console.error('Woo Get Product Error:', e.message);
      return null;
    }
  },

  // ثبت سفارش
  createOrder: async (connection, orderData) => {
    try {
      const siteUrl = connection.siteUrl.replace(/\/$/, '');

      const names = (orderData.fullName || 'کاربر مهمان').split(' ');
      const firstName = names[0];
      const lastName = names.length > 1 ? names.slice(1).join(' ') : 'مهمان';

      const payload = {
        payment_method: 'bacs',
        payment_method_title: 'پرداخت آنلاین',
        set_paid: false,
        billing: {
          first_name: firstName,
          last_name: lastName,
          address_1: orderData.address,
          city: 'Tehran',
          phone: orderData.phone,
          email: 'guest@generated.com',
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
