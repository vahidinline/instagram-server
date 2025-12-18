const mongoose = require('mongoose');

const IGConnectionsSchema = new mongoose.Schema({
  // ... فیلدهای قبلی ...
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  ig_userId: { type: String, required: true, unique: true },
  username: String,
  account_name: String,
  profile_picture_url: String,
  access_token: { type: String, required: true },

  // *** تنظیمات ربات (آپدیت شده) ***
  botConfig: {
    isActive: { type: Boolean, default: true },
    responseDelay: { type: Number, default: 0 },

    // --- تنظیمات جدید کامنت ---
    publicReplyText: { type: String, default: 'پاسخ را دایرکت کردم ✅' }, // متنی که زیر کامنت می‌نویسد
    checkFollow: { type: Boolean, default: false }, // آیا فالو را چک کند؟
    followWarning: {
      type: String,
      default: 'لطفاً ابتدا پیج را فالو کنید تا بتوانم پاسخ را بفرستم 🙏',
    }, // پیام اگر فالو نداشت
  },

  aiConfig: {
    enabled: { type: Boolean, default: false },
    // تغییر: به جای متن مستقیم، آی‌دی پرسونا را نگه می‌داریم
    activePersonaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Persona' },
    // جهت اطمینان (Fallback)، اگر پرسونا پاک شد، این متن بماند:
    systemPrompt: { type: String, default: 'You are a helpful assistant.' },
  },

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('IGConnections', IGConnectionsSchema);
