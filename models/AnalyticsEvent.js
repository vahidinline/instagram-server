const mongoose = require('mongoose');

const AnalyticsEventSchema = new mongoose.Schema({
  ig_accountId: { type: String, required: true, index: true }, // کانال
  persona_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Persona',
    index: true,
  }, // 👈 کلید ماجرا اینجاست
  user_id: { type: String }, // شناسه کاربر (Guest/IG)

  eventType: {
    type: String,
    enum: [
      'ENGAGEMENT',
      'PRODUCT_VIEW',
      'LEAD_CAPTURED',
      'LINK_GENERATED',
      'ORDER_PAID',
    ],
    required: true,
  },

  metaData: { type: Object }, // مثلا مبلغ سفارش یا نام محصول
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('AnalyticsEvent', AnalyticsEventSchema);
