const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  description: String,
  price: { type: Number, required: true },
  durationDays: { type: Number, default: 30 },

  // محدودیت‌های قابل شمارش
  limits: {
    messageCount: { type: Number, default: 1000 },
    accountCount: { type: Number, default: 1 },
    aiTokenLimit: { type: Number, default: 0 }, // <--- جدید: سقف توکن هوش مصنوعی
  },

  features: {
    aiAccess: { type: Boolean, default: false },
    removeBranding: { type: Boolean, default: false },
    prioritySupport: { type: Boolean, default: false },
  },

  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
});

module.exports = mongoose.model('Plan', PlanSchema);
