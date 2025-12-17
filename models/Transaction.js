const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  plan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },

  amount: { type: Number, required: true }, // مبلغ پرداختی
  authority: { type: String, required: true }, // کد پیگیری زرین‌بال (قبل از پرداخت)
  refId: { type: String }, // کد رهگیری موفق (بعد از پرداخت)

  status: {
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'pending',
  },
  gateway: { type: String, default: 'zarinpal' },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Transaction', TransactionSchema);
