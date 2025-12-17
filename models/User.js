const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  // کد OTP موقت و زمان انقضا
  otp: { type: String },
  otpExpires: { type: Date },

  name: { type: String },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  plan: { type: String, default: 'free' },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', UserSchema);
