const axios = require('axios');

const wooService = {
  // 1. جستجوی محصول
  searchProducts: async (connection, query) => {
    try {
      // حذف اسلش آخر URL اگر وجود داشت
      const siteUrl = connection.siteUrl.replace(/\/$/, '');

      // درخواست به API ووکامرس
      const response = await axios.get(`${siteUrl}/wp-json/wc/v3/products`, {
        params: {
          search: query,
          status: 'publish',
          stock_status: 'instock', // فقط موجودها
          per_page: 5, // حداکثر ۵ محصول
        },
        auth: {
          username: connection.consumerKey,
          password: connection.consumerSecret,
        },
      });

      if (response.data.length === 0) return 'هیچ محصولی با این نام یافت نشد.';

      // فرمت‌دهی برای AI و ویجت
      return response.data.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        stock_quantity: p.stock_quantity, // تعداد موجودی
        permalink: p.permalink,
        image: p.images[0]?.src || '',
        description: p.short_description
          .replace(/<[^>]*>?/gm, '')
          .substring(0, 100), // حذف HTML
      }));
    } catch (error) {
      console.error('Woo API Error:', error.response?.data || error.message);
      return 'خطا در اتصال به فروشگاه. لطفاً تنظیمات API را چک کنید.';
    }
  },

  // 2. پیگیری سفارش
  getOrderStatus: async (connection, orderId) => {
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
      const statusMap = {
        pending: 'در انتظار پرداخت',
        processing: 'در حال انجام',
        'on-hold': 'در انتظار بررسی',
        completed: 'تکمیل شده',
        cancelled: 'لغو شده',
        refunded: 'مسترد شده',
        failed: 'ناموفق',
      };

      return {
        order_id: order.id,
        status: statusMap[order.status] || order.status,
        total: order.total,
        date: order.date_created,
        items: order.line_items.map((i) => i.name).join(', '),
      };
    } catch (error) {
      return 'سفارشی با این شماره یافت نشد یا دسترسی وجود ندارد.';
    }
  },
};

module.exports = wooService;
