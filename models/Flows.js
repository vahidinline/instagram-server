const mongoose = require('mongoose');

const FlowSchema = new mongoose.Schema({
  ig_accountId: { type: String, required: true },
  name: { type: String, required: true },

  messages: [
    {
      // انواع پیام گسترش یافت
      type: {
        type: String,
        enum: ['text', 'image', 'video', 'audio', 'card', 'ai_response'],
        default: 'text',
      },

      content: { type: String }, // متن (برای text/ai) یا کپشن
      media_url: { type: String }, // لینک فایل (برای image/video/audio)

      // دکمه‌ها (برای text/image/video)
      buttons: [
        {
          title: { type: String },
          url: { type: String },
          type: { type: String, default: 'web_url' },
        },
      ],

      // *** جدید: مخصوص کاروسل (Card/Generic Template) ***
      cards: [
        {
          title: { type: String },
          subtitle: { type: String },
          image_url: { type: String },
          default_action_url: { type: String }, // وقتی روی خود عکس کلیک شد
          buttons: [
            {
              title: { type: String },
              url: { type: String },
              type: { type: String, default: 'web_url' },
            },
          ],
        },
      ],
    },
  ],

  usage_count: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Flows', FlowSchema);
