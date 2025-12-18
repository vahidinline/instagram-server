const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema({
  ig_accountId: { type: String, required: true, index: true }, // مربوط به کدام بیزینس

  // اطلاعات مشتری در اینستاگرام
  instagram_user_id: { type: String, required: true },
  instagram_username: { type: String },
  instagram_fullname: { type: String },

  // اطلاعات استخراج شده توسط هوش مصنوعی
  extracted_name: { type: String }, // نامی که مشتری در چت گفته
  phone: { type: String, required: true }, // شماره تماس (حیاتی)
  interest_product: { type: String }, // محصول مورد علاقه (Context)

  // وضعیت پیگیری (برای CRM)
  status: {
    type: String,
    enum: ['new', 'contacted', 'purchased', 'lost'],
    default: 'new',
  },

  created_at: { type: Date, default: Date.now },
});

// جلوگیری از ثبت تکراری یک شماره برای یک اکانت
LeadSchema.index({ ig_accountId: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model('Lead', LeadSchema);
