const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  ig_accountId: { type: String, required: true, index: true }, // مربوط به کدام بیزینس ماست
  sender_id: { type: String, required: true, index: true }, // IGSID کاربر

  // مشخصات پایه
  username: String,
  fullName: String,
  profilePic: String,

  // 1. تحلیل احساسات (میانگین کل)
  sentimentScore: { type: Number, default: 50 }, // 0 (خشمگین) تا 100 (عاشق)
  sentimentLabel: {
    type: String,
    enum: ['positive', 'neutral', 'negative'],
    default: 'neutral',
  },

  // 2. دسته‌بندی اتوماتیک (تگ‌ها)
  tags: [{ type: String }], // مثلا: ["قیمت", "شکایت", "خرید عمده"]

  // 3. ارزش طول عمر (CLV)
  interactionCount: { type: Number, default: 0 }, // تعداد کل پیام‌ها
  leadScore: { type: Number, default: 0 }, // امتیاز احتمال خرید
  isLead: { type: Boolean, default: false }, // آیا شماره داده؟

  lastInteraction: { type: Date, default: Date.now },
  firstInteraction: { type: Date, default: Date.now },
});

// جلوگیری از تکراری شدن مشتری برای یک اکانت
CustomerSchema.index({ ig_accountId: 1, sender_id: 1 }, { unique: true });

module.exports = mongoose.model('Customer', CustomerSchema);
