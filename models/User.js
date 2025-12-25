const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  // --- روش ورود ۱: موبایل ---
  phone: {
    type: String,
    unique: true,
    sparse: true, // اجازه می‌دهد نال باشد (برای کاربرانی که فقط ایمیل دارند)
  },
  otp: { type: String },
  otpExpires: { type: Date },

  // --- روش ورود ۲: گوگل ---
  email: {
    type: String,
    unique: true,
    sparse: true, // اجازه می‌دهد نال باشد (برای کاربرانی که فقط موبایل دارند)
    lowercase: true,
  },
  googleId: { type: String }, // شناسه یکتای گوگل
  avatar: { type: String }, // عکس پروفایل گوگل

  // --- اطلاعات عمومی ---
  name: { type: String },
  role: {
    type: String,
    default: 'user',
    enum: ['user', 'admin'],
  },

  // ارتباط با پلن‌ها
  plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },

  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', UserSchema);
