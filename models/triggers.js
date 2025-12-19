const mongoose = require('mongoose');

const TriggerSchema = new mongoose.Schema({
  app_userId: { type: String, required: true },
  ig_accountId: { type: String, required: true },

  keywords: {
    type: [String],
    required: true,
    set: (v) => v.map((k) => k.toLowerCase().trim()),
  },

  match_type: {
    type: String,
    enum: ['exact', 'contains', 'starts_with'],
    default: 'contains',
  },

  // *** تغییر جدید: محدود کردن تریگر به یک پست خاص ***
  // اگر null باشد یعنی روی همه پست‌ها کار می‌کند
  media_id: { type: String, default: null },

  flow_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Flows',
    required: true,
  },

  is_active: { type: Boolean, default: true },
  type: { type: String, enum: ['dm', 'comment', 'both'], default: 'both' },
});

module.exports = mongoose.model('Triggers', TriggerSchema);
