const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  phone: {
    type: String,
    unique: true,
    sparse: true,
  },

  // جدید: اضافه کردن ایمیل و گوگل آیدی
  email: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
  },
  name: { type: String }, // نام نمایشی گوگل
  avatar: { type: String }, // عکس پروفایل گوگل

  otp: { type: String },
  otpExpires: { type: Date },
  name: { type: String },
  role: { type: String, default: 'user' },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', UserSchema);
