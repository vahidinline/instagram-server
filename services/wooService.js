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

  // دریافت اطلاعات دقیق (بهینه شده برای AI)
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

      if (p.type === 'variable') {
        try {
          const varResponse = await axios.get(
            `${siteUrl}/wp-json/wc/v3/products/${productId}/variations`,
            {
              params: { per_page: 50 },
              auth,
            }
          );

          const summary = varResponse.data
            .map((v) => {
              const attrs = v.attributes
                .map((a) => `${a.name}: ${a.option}`)
                .join(', ');
              let stockInfo = 'Out of Stock';

              if (v.stock_status === 'instock') {
                if (v.stock_quantity !== null && v.stock_quantity > 0) {
                  stockInfo = `Qty: ${v.stock_quantity} (Available)`;
                } else {
                  stockInfo = `Status: Available (Backorder Allowed)`;
                }
              } else if (v.stock_status === 'onbackorder') {
                stockInfo = `Status: Available (Pre-order)`;
              }

              return ` - Variant [${attrs}] => Price: ${v.price}, Stock: ${stockInfo}, ID: ${v.id}`;
            })
            .join('\n');

          productData.variations_summary = `THIS IS A VARIABLE PRODUCT. OPTIONS:\n${summary}`;
        } catch (e) {
          console.log('Error fetching variations:', e.message);
        }
      } else {
        let attributesStr = '';
        if (p.attributes && p.attributes.length > 0) {
          attributesStr = p.attributes
            .map((a) => `${a.name}: ${a.options.join(', ')}`)
            .join(' | ');
        }

        let stockInfo = 'Out of Stock';
        if (p.stock_status === 'instock') {
          if (p.stock_quantity !== null && p.stock_quantity > 0) {
            stockInfo = `Qty: ${p.stock_quantity}`;
          } else {
            stockInfo = `Status: Available (Backorder Allowed)`;
          }
        }
        productData.variations_summary = `SIMPLE PRODUCT. Attributes: ${
          attributesStr || 'None'
        }\nStock Info: ${stockInfo}`;
      }

      console.log(`📦 Woo Output:\n${productData.variations_summary}`);
      return productData;
    } catch (e) {
      console.error('Woo Get Product Error:', e.message);
      return null;
    }
  },

  // ✅ ثبت سفارش (اصلاح اساسی برای رفع ارور ۵۰۰)
  createOrder: async (connection, orderData) => {
    // 1. پاکسازی داده‌ها: فقط items را بردار و بقیه را نادیده بگیر
    const cleanItems = (orderData.items || []).filter(
      (i) => i.productId && !isNaN(i.productId)
    );

    // اگر آیتمی نبود، خطا بده
    if (cleanItems.length === 0) {
      return {
        success: false,
        message: 'هیچ محصول معتبری برای سفارش یافت نشد.',
      };
    }

    console.log(
      '🛒 WooService: Creating Order with CLEAN Items:',
      JSON.stringify(cleanItems)
    );

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
          phone: orderData.phone,
          email: 'guest@generated.com',
        },
        line_items: cleanItems.map((item) => ({
          product_id: item.productId,
          quantity: item.quantity || 1,
        })),
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

      console.log('✅ Single Order Created. ID:', response.data.id);

      const order = response.data;
      const payLink =
        order.payment_url ||
        `${siteUrl}/checkout/order-pay/${order.id}/?pay_for_order=true&key=${order.order_key}`;

      return {
        success: true,
        order_id: order.id,
        payment_url: payLink,
        message: 'سفارش با موفقیت ثبت شد.',
      };
    } catch (error) {
      console.error(
        '❌ Woo Order Error:',
        error.response?.data || error.message
      );
      return { success: false, message: 'خطا در ارتباط با فروشگاه.' };
    }
  },
};

module.exports = wooService;
