const mongoose = require('mongoose');

const PersonaSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = پرسونای سیستمی
  name: { type: String, required: true },
  description: String, // توضیح کوتاه (مثلاً: مناسب برای فروش)
  systemPrompt: { type: String, required: true }, // دستورالعمل اصلی
  icon: { type: String, default: 'Bot' }, // نام آیکون برای نمایش در فرانت
  isSystem: { type: Boolean, default: false }, // آیا سیستمی است؟
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Persona', PersonaSchema);
