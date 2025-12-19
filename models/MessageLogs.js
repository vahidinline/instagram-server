const mongoose = require('mongoose');

const MessageLogSchema = new mongoose.Schema({
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

  // *** بخش مهم: لیست وضعیت‌های مجاز ***
  status: {
    type: String,
    enum: [
      'received', // دریافت شد
      'processed', // پردازش شد (تریگر)
      'replied', // پاسخ داده شد (تریگر)
      'failed', // خطا
      'ignored', // نادیده گرفته شد (خاموشی ربات)
      'replied_ai', // پاسخ هوش مصنوعی (جدید) ✅
      'processed_ai', // پردازش شده توسط AI (جدید) ✅
      'replied_comment', // پاسخ دایرکت به کامنت (جدید) ✅
    ],
    default: 'received',
  },

  // کدام تریگر باعث این پاسخ شد؟ (برای AI نال است)
  triggered_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Triggers',
    default: null,
  },

  created_at: { type: Date, default: Date.now },
});

// ایندکس‌گذاری برای سرعت بالا
MessageLogSchema.index({ ig_accountId: 1, created_at: -1 });
MessageLogSchema.index({ sender_id: 1 });

module.exports = mongoose.model('MessageLog', MessageLogSchema);
