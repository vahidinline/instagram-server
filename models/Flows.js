const mongoose = require('mongoose');

const FlowSchema = new mongoose.Schema({
  ig_accountId: { type: String, required: true },
  name: { type: String, required: true },

  messages: [
    {
      type: { type: String, enum: ['text', 'image', 'card'], default: 'text' },
      content: { type: String, required: true }, // متن اصلی

      // *** اضافه شد: دکمه‌ها (فقط برای دایرکت) ***
      buttons: [
        {
          title: { type: String, required: true }, // متن دکمه (مثلا: خرید)
          url: { type: String, required: true }, // لینک سایت
          type: { type: String, default: 'web_url' }, // فعلا فقط لینک وب
        },
      ],
    },
  ],
  messages: [
    {
      type: {
        type: String,
        enum: ['text', 'image', 'card', 'ai_response'],
        default: 'text',
      },
      content: { type: String }, // اگر ai_response باشد، این فیلد می‌تواند خالی باشد یا "دستور خاص" برای AI باشد
      // ... buttons ...
    },
  ],

  usage_count: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Flows', FlowSchema);
