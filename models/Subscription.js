const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  plan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },

  // Snapshot از لیمیت‌ها
  currentLimits: {
    messageCount: Number,
    accountCount: Number,
    aiTokenLimit: Number, // <--- جدید
  },
  currentFeatures: {
    aiAccess: Boolean,
    removeBranding: Boolean,
  },

  // Usage Tracking
  usage: {
    messagesUsed: { type: Number, default: 0 },
    accountsUsed: { type: Number, default: 0 },
    aiTokensUsed: { type: Number, default: 0 }, // <--- جدید: کنتور مصرف توکن
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
