const mongoose = require('mongoose');

const PersonaSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  name: { type: String, required: true },
  gender: { type: String, enum: ['male', 'female', 'robot'], default: 'robot' },
  avatar: { type: String, default: '' },

  config: {
    tone: { type: Number, default: 50 },
    emojiUsage: { type: Boolean, default: true },
    responseLength: { type: String, default: 'medium' },
    role: { type: String, default: 'sales' },
    salesStrategy: {
      aggressiveness: { type: String, default: 'passive' },
      collectLead: { type: Boolean, default: true },
    },
    customKnowledge: { type: String, default: '' },
  },

  systemPrompt: { type: String, required: true },

  isSystem: { type: Boolean, default: false }, // برای همه کاربران (قالب آماده)

  // ✅ فیلد جدید: پرسونای مدیریت شده (VIP)
  // اگر true باشد، کاربر نمی‌تواند آن را حذف یا ویرایش کند و پرامپت را نمی‌بیند.
  isLocked: { type: Boolean, default: false },

  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Persona', PersonaSchema);
