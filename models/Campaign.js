const mongoose = require('mongoose');

const CampaignSchema = new mongoose.Schema({
  app_userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  ig_accountId: { type: String, required: true, index: true },

  name: { type: String, required: true },
  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'scheduled'],
    default: 'active',
  },

  // هدف‌گذاری روی پست خاص
  media_id: { type: String, required: true }, // ID پست در اینستاگرام
  media_url: { type: String }, // عکس پست (برای نمایش در پنل)

  // شرط فعال‌سازی
  keywords: [{ type: String }],
  match_type: { type: String, default: 'contains' },

  // *** A/B Testing Core ***
  ab_testing: {
    enabled: { type: Boolean, default: false },
    split_percentage: { type: Number, default: 50 }, // مثلا ۵۰٪ ترافیک بره سمت B

    variant_a: {
      flow_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Flows',
        required: true,
      },
      sent_count: { type: Number, default: 0 },
      leads_count: { type: Number, default: 0 }, // چند لید از این فلو آمد؟
    },

    variant_b: {
      flow_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Flows' }, // اختیاری
      sent_count: { type: Number, default: 0 },
      leads_count: { type: Number, default: 0 },
    },
  },

  schedule: {
    startDate: { type: Date, default: Date.now }, // تاریخ شروع
    endDate: { type: Date }, // تاریخ پایان (اختیاری)

    // ساعت کاری روزانه (مثلاً فقط ۹ صبح تا ۹ شب فعال باشد)
    dailyStartTime: { type: String, default: '00:00' },
    dailyEndTime: { type: String, default: '23:59' },
    timezone: { type: String, default: 'Asia/Tehran' },
  },

  // محدودیت‌ها (Scarcity)
  limits: {
    maxReplies: { type: Number, default: 0 }, // 0 = نامحدود
    currentReplies: { type: Number, default: 0 }, // شمارنده داخلی
  },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Campaign', CampaignSchema);
