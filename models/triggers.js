const mongoose = require('mongoose');

const TriggerSchema = new mongoose.Schema({
  app_userId: { type: String, required: true },
  ig_accountId: { type: String, required: true },

  // *** تغییر اصلی: تبدیل String به [String] ***
  keywords: {
    type: [String],
    required: true,
    // تابع ستتر برای اینکه مطمئن شویم همیشه حروف کوچک ذخیره می‌شوند
    set: (v) => v.map((k) => k.toLowerCase().trim()),
  },

  match_type: {
    type: String,
    enum: ['exact', 'contains'], // شامل (contains) و دقیق (exact)
    default: 'contains',
  },

  // اتصال به فلو (معماری جدید)
  flow_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Flows',
    required: true,
  },

  is_active: { type: Boolean, default: true },
  type: { type: String, enum: ['dm', 'comment', 'both'], default: 'both' },
});

module.exports = mongoose.model('Triggers', TriggerSchema);
