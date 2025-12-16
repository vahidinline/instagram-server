const mongoose = require('mongoose');

const FlowSchema = new mongoose.Schema({
  ig_accountId: { type: String, required: true },
  name: { type: String, required: true }, // نام فلو برای نمایش در پنل (مثلا: خوش‌آمدگویی)

  // آرایه‌ای از پیام‌ها (فعلا متن، بعدا عکس و...)
  messages: [
    {
      type: { type: String, enum: ['text', 'image'], default: 'text' },
      content: { type: String, required: true },
    },
  ],

  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Flows', FlowSchema);
