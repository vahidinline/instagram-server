const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema({
  name: { type: String, required: true }, // مثال: "حرفه‌ای"
  slug: { type: String, required: true, unique: true }, // مثال: "pro_monthly"
  description: String,
  price: { type: Number, required: true }, // قیمت به تومان
  durationDays: { type: Number, default: 30 }, // مدت اعتبار (۳۰ روز)

  // محدودیت‌های قابل شمارش (Quota)
  limits: {
    messageCount: { type: Number, default: 1000 }, // تعداد پیام مجاز
    accountCount: { type: Number, default: 1 }, // تعداد اکانت اینستاگرام مجاز
  },

  // قابلیت‌های بولین (دسترسی دارد/ندارد)
  features: {
    aiAccess: { type: Boolean, default: false }, // دسترسی به هوش مصنوعی
    removeBranding: { type: Boolean, default: false },
    prioritySupport: { type: Boolean, default: false },
  },

  isActive: { type: Boolean, default: true }, // برای آرشیو کردن پلن‌های قدیمی
  sortOrder: { type: Number, default: 0 }, // برای نمایش در فرانت
});

module.exports = mongoose.model('Plan', PlanSchema);
