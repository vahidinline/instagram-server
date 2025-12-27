const axios = require('axios');

const wooService = {
  // جستجوی محصول
  searchProducts: async (connection, query) => {
    try {
      console.log(`🔎 WooService: Searching for "${query}"...`);
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
        subtitle: `${parseInt(p.price || 0).toLocaleString()} تومان`,
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

  // ✅ دریافت اطلاعات دقیق (بهینه شده برای درک هوش مصنوعی)
  getProductById: async (connection, productId) => {
    try {
      console.log(`🔎 WooService: Fetching Details for ID ${productId}...`);
      const siteUrl = connection.siteUrl.replace(/\/$/, '');
      const auth = {
        username: connection.consumerKey,
        password: connection.consumerSecret,
      };

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
        stock_status: p.stock_status,
        type: p.type,
        variations_summary: '',
      };

      // الف: محصول متغیر (Variable)
      if (p.type === 'variable') {
        try {
          const varResponse = await axios.get(
            `${siteUrl}/wp-json/wc/v3/products/${productId}/variations`,
            {
              params: { per_page: 50 }, // افزایش تعداد برای اطمینان
              auth,
            }
          );

          // فرمت خروجی دقیق برای AI:
          // [Attribute: Value] => Price: X, Stock: (Qty: 5 OR Status: In Stock)
          const summary = varResponse.data
            .map((v) => {
              const attrs = v.attributes
                .map((a) => `${a.name}: ${a.option}`)
                .join(', ');

              // لاجیک مهم: اگر تعداد نال بود (یعنی مدیریت موجودی خاموش است)، وضعیت را چک کن
              let stockInfo = 'Status: Out of Stock';
              if (v.stock_quantity !== null) {
                stockInfo = `Qty: ${v.stock_quantity}`; // عدد دقیق
              } else if (v.stock_status === 'instock') {
                stockInfo = `Status: In Stock (Unlimited)`; // وضعیت موجود
              }

              return ` - Variant [${attrs}] => Price: ${v.price}, Stock: ${stockInfo}, ID: ${v.id}`;
            })
            .join('\n');

          productData.variations_summary = `THIS IS A VARIABLE PRODUCT. AVAILABLE OPTIONS:\n${summary}`;
        } catch (e) {
          console.log('Error fetching variations:', e.message);
        }
      }
      // ب: محصول ساده (Simple)
      else {
        let attributesStr = '';
        if (p.attributes && p.attributes.length > 0) {
          attributesStr = p.attributes
            .map((a) => `${a.name}: ${a.options.join(', ')}`)
            .join(' | ');
        }

        let stockInfo = 'Status: Out of Stock';
        if (p.stock_quantity !== null) {
          stockInfo = `Qty: ${p.stock_quantity}`;
        } else if (p.stock_status === 'instock') {
          stockInfo = `Status: In Stock (Unlimited)`;
        }

        productData.variations_summary = `
          THIS IS A SIMPLE PRODUCT.
          Attributes: ${attributesStr || 'None'}
          Stock Info: ${stockInfo}
          `;
      }

      console.log(`📦 Woo Output:\n${productData.variations_summary}`);
      return productData;
    } catch (e) {
      console.error('Woo Get Product Error:', e.message);
      return null;
    }
  },

  // ثبت سفارش (با دریافت تعداد)
  createOrder: async (connection, orderData) => {
    console.log('🛒 WooService: Creating Order...', orderData);
    try {
      const siteUrl = connection.siteUrl.replace(/\/$/, '');

      const names = (orderData.fullName || 'کاربر مهمان').split(' ');
      const firstName = names[0];
      const lastName = names.length > 1 ? names.slice(1).join(' ') : 'مهمان';

      // پیدا کردن ID محصول
      // اگر محصول ساده است، همان productId
      // اگر متغیر است، ما VariationID را نیاز داریم.
      // اما اینجا هوش مصنوعی معمولا ID کلی را می‌فرستد.
      // *بهینه‌سازی:* هوش مصنوعی باید Variation ID را بفرستد، اما اگر نفرستاد ووکامرس خودش تلاش میکند هندل کند.
      // برای سادگی فعلا همان ID ارسالی را می‌فرستیم. (در فاز بعد دقیقتر میکنیم)

      const payload = {
        payment_method: 'bacs',
        payment_method_title: 'پرداخت آنلاین',
        set_paid: false,
        billing: {
          first_name: firstName,
          last_name: lastName,
          address_1: orderData.address,
          phone: orderData.phone,
          email: 'guest@generated.com',
        },
        line_items: [
          {
            product_id: orderData.productId,
            quantity: orderData.quantity || 1, // ✅ دریافت تعداد از ورودی
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

      console.log('✅ Order Created. ID:', response.data.id);

      const order = response.data;
      const payLink =
        order.payment_url ||
        `${siteUrl}/checkout/order-pay/${order.id}/?pay_for_order=true&key=${order.order_key}`;

      return {
        success: true,
        order_id: order.id,
        payment_url: payLink,
        message: 'سفارش ثبت شد.',
      };
    } catch (error) {
      console.error(
        '❌ Woo Order Error:',
        error.response?.data || error.message
      );
      return { success: false, message: 'خطا در ثبت سفارش.' };
    }
  },
};

module.exports = wooService;
