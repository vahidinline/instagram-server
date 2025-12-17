const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  plan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },

  // *** Snapshot: کپی کردن لیمیت‌ها در لحظه خرید ***
  // این باعث می‌شود تغییرات آینده پلن روی کاربر فعلی اثر نگذارد
  currentLimits: {
    messageCount: Number,
    accountCount: Number,
  },
  currentFeatures: {
    aiAccess: Boolean,
    removeBranding: Boolean,
  },

  // *** Usage Tracking: مصرف لحظه‌ای ***
  usage: {
    messagesUsed: { type: Number, default: 0 },
    accountsUsed: { type: Number, default: 0 },
  },

  startDate: { type: Date, default: Date.now },
  endDate: { type: Date, required: true },

  status: {
    type: String,
    enum: ['active', 'expired', 'canceled'],
    default: 'active',
  },
});

module.exports = mongoose.model('Subscription', SubscriptionSchema);
