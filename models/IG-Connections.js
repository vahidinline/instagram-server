const mongoose = require('mongoose');

const IGConnectionsSchema = new mongoose.Schema({
  // *** تغییر مهم: اتصال به مدل User ***
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  ig_userId: { type: String, required: true, unique: true },
  username: String,
  account_name: String,
  profile_picture_url: String,
  access_token: { type: String, required: true },

  // تنظیمات اختصاصی هر اکانت
  isActive: { type: Boolean, default: true },
  botConfig: {
    isActive: { type: Boolean, default: true }, // سوییچ اصلی
    responseDelay: { type: Number, default: 0 }, // تاخیر به ثانیه
    workingHours: { type: Boolean, default: false }, // آیا ساعات کاری فعال باشد؟
    // میتوانید ساعات شروع و پایان را هم بعدا اضافه کنید
  },

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

// app_userId قدیمی را حذف کردیم و user_id گذاشتیم
module.exports = mongoose.model('IGConnections', IGConnectionsSchema);
