const mongoose = require('mongoose');

const MessageLogSchema = new mongoose.Schema({
  app_userId: { type: String, required: false }, // مالک پنل (ادمین)
  ig_accountId: { type: String, required: true }, // اکانت بیزینسی ما

  // طرف مقابل (مشتری)
  sender_id: { type: String, required: true },
  sender_username: { type: String, default: 'Instagram User' },
  sender_avatar: { type: String, default: '' },

  // محتوا
  message_type: {
    type: String,
    enum: ['text', 'image', 'story_reply', 'unknown'],
    default: 'text',
  },
  content: { type: String },

  // جهت پیام
  direction: { type: String, enum: ['incoming', 'outgoing'], required: true },

  // وضعیت (برای آنالیز)
  status: {
    type: String,
    enum: ['received', 'processed', 'replied', 'failed', 'ignored'],
    default: 'received',
  },

  // کدام تریگر باعث این پاسخ شد؟ (برای آمارگیری تریگرها)
  triggered_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Triggers',
    default: null,
  },

  created_at: { type: Date, default: Date.now },
});

// ایندکس‌گذاری برای سرعت بالا در کوئری‌های آنالیز
MessageLogSchema.index({ ig_accountId: 1, created_at: -1 });
MessageLogSchema.index({ sender_id: 1 });

module.exports = mongoose.model('MessageLog', MessageLogSchema);
