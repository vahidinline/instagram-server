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

  // اعتبارنامه‌های ووکامرس
  consumerKey: { type: String },
  consumerSecret: { type: String },

  // تنظیمات ظاهری ویجت
  widgetConfig: {
    color: { type: String, default: '#4F46E5' },
    welcomeMessage: { type: String, default: 'سلام! چطور میتونم کمکتون کنم؟' },
    logoUrl: { type: String },
    position: { type: String, enum: ['right', 'left'], default: 'right' },
  },

  // تنظیمات هوش مصنوعی و پرسونا (✅ جدید)
  aiConfig: {
    enabled: { type: Boolean, default: true },
    // اتصال به مدل پرسونا برای تعیین لحن
    activePersonaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Persona',
      default: null,
    },
    // تنظیمات دستی اگر پرسونا انتخاب نشود
    strictMode: { type: Boolean, default: false },
    creativity: { type: Number, default: 0.5 },
  },

  // تنظیمات ربات (قوانین)
  botConfig: {
    isActive: { type: Boolean, default: true },
    checkInventory: { type: Boolean, default: true },
    responseDelay: { type: Number, default: 0 },
  },

  isActive: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('WebConnection', WebConnectionSchema);
