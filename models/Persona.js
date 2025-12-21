const mongoose = require('mongoose');

const PersonaSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = سیستمی

  // هویت بصری
  name: { type: String, required: true },
  gender: { type: String, enum: ['male', 'female', 'robot'], default: 'robot' },
  avatar: { type: String, default: '' }, // لینک عکس یا نام آیکون

  // تنظیمات رفتاری (برای تولید پرامپت)
  config: {
    tone: { type: Number, default: 50 }, // 0 (رسمی) تا 100 (صمیمی)
    emojiUsage: { type: Boolean, default: true },
    responseLength: {
      type: String,
      enum: ['short', 'medium', 'long'],
      default: 'medium',
    },
    languageStyle: {
      type: String,
      enum: ['formal', 'casual', 'slang'],
      default: 'casual',
    },
  },

  // خروجی نهایی (که به GPT داده می‌شود)
  systemPrompt: { type: String, required: true },

  isSystem: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Persona', PersonaSchema);
