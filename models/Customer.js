const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  ig_accountId: { type: String, required: true, index: true },
  sender_id: { type: String, required: true, index: true },

  username: String,
  fullName: String,
  profilePic: String,

  // CRM Data
  sentimentLabel: {
    type: String,
    enum: ['positive', 'neutral', 'negative'],
    default: 'neutral',
  },
  leadScore: { type: Number, default: 0 },
  tags: [{ type: String }],

  // *** بخش جدید: پایپ‌لاین فروش ***
  stage: {
    type: String,
    enum: [
      'lead', // سرنخ تازه (پیام اول)
      'interested', // علاقمند (قیمت پرسیده)
      'negotiation', // مذاکره (چانه زدن یا سوالات تخصصی)
      'ready_to_buy', // داغ (شماره کارت خواسته یا لید داده)
      'customer', // مشتری (خرید کرده)
      'churned', // از دست رفته (ناراضی)
    ],
    default: 'lead',
  },

  // تاریخچه تغییر مراحل (برای نمودارهای آینده)
  stageHistory: [
    {
      from: String,
      to: String,
      date: { type: Date, default: Date.now },
      reason: String, // مثلا: "AI detected purchase intent"
    },
  ],

  interactionCount: { type: Number, default: 0 },
  isLead: { type: Boolean, default: false },

  lastInteraction: { type: Date, default: Date.now },
  firstInteraction: { type: Date, default: Date.now },
});

CustomerSchema.index({ ig_accountId: 1, sender_id: 1 }, { unique: true });
// ایندکس برای سرعت بالای کانبان
CustomerSchema.index({ ig_accountId: 1, stage: 1 });

module.exports = mongoose.model('Customer', CustomerSchema);
