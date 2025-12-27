const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema({
  ig_accountId: { type: String, required: true, index: true }, // شناسه کانال (وب یا اینستا)

  // --- تغییرات برای Omnichannel ---
  platform: {
    type: String,
    enum: ['instagram', 'web', 'telegram', 'whatsapp'],
    default: 'instagram',
    required: true,
  },

  // شناسه عمومی کاربر (در وب guest_id، در اینستا psid)
  sender_id: { type: String, required: true, index: true },

  // اطلاعات اختصاصی اینستاگرام (اختیاری شدند)
  instagram_user_id: { type: String },
  instagram_username: { type: String },
  instagram_fullname: { type: String },

  // اطلاعات استخراج شده توسط هوش مصنوعی
  extracted_name: { type: String },
  phone: { type: String, required: true },
  interest_product: { type: String },

  // وضعیت پیگیری
  status: {
    type: String,
    enum: ['new', 'contacted', 'purchased', 'lost'],
    default: 'new',
  },

  created_at: { type: Date, default: Date.now },
});

// ایندکس ترکیبی: برای هر کانال، هر شماره موبایل فقط یک لید باز داشته باشد (اختیاری)
LeadSchema.index({ ig_accountId: 1, phone: 1 }, { unique: false });

module.exports = mongoose.model('Lead', LeadSchema);
