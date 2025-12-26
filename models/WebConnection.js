const mongoose = require('mongoose');

const WebConnectionSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // مشخصات سایت
  name: { type: String, required: true }, // نام فروشگاه
  siteUrl: { type: String, required: true },
  platform: {
    type: String,
    enum: ['woocommerce', 'custom'],
    default: 'woocommerce',
  },

  // اعتبارنامه‌های ووکامرس (برای دسترسی به محصولات/سفارشات)
  consumerKey: { type: String },
  consumerSecret: { type: String }, // نکته: در پروداکشن واقعی باید رمزنگاری شود

  // تنظیمات ظاهری ویجت
  widgetConfig: {
    color: { type: String, default: '#4F46E5' }, // رنگ اصلی
    welcomeMessage: { type: String, default: 'سلام! چطور میتونم کمکتون کنم؟' },
    logoUrl: { type: String },
    position: { type: String, enum: ['right', 'left'], default: 'right' },
  },

  // تنظیمات ربات برای این کانال
  botConfig: {
    isActive: { type: Boolean, default: true },
    checkInventory: { type: Boolean, default: true }, // آیا موجودی چک کند؟
    trackOrders: { type: Boolean, default: true }, // آیا پیگیری سفارش انجام دهد؟
  },

  isActive: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('WebConnection', WebConnectionSchema);
