const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true, // فقط شماره موبایل باید یکتا باشد
    index: true,
  },

  // *** تغییر مهم: حذف unique و required از ایمیل ***
  email: {
    type: String,
    required: false, // الزامی نیست
    unique: false, // یکتا بودن هم فعلا نمی‌خواهیم (یا باید sparse: true باشد)
  },

  otp: { type: String },
  otpExpires: { type: Date },
  name: { type: String },
  role: { type: String, default: 'user' },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', UserSchema);
