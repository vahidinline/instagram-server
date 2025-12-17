const mongoose = require('mongoose');
const Plan = require('./models/Plan');
const Subscription = require('./models/Subscription');
const User = require('./models/User'); // برای پیدا کردن کاربر خودت
require('dotenv').config();

mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`
  )
  .then(async () => {
    console.log('🔌 Connected...');

    // 1. ساخت پلن‌ها
    console.log('Creating Plans...');
    await Plan.deleteMany({}); // پاک کردن پلن‌های قبلی

    const freePlan = await Plan.create({
      name: 'رایگان (شروع)',
      slug: 'free_trial',
      description: 'برای تست سیستم',
      price: 0,
      durationDays: 14,
      limits: { messageCount: 50, accountCount: 1 },
      features: { aiAccess: false },
      sortOrder: 1,
    });

    const proPlan = await Plan.create({
      name: 'حرفه‌ای',
      slug: 'pro_monthly',
      description: 'مناسب کسب‌وکارهای در حال رشد',
      price: 299000, // تومان
      durationDays: 30,
      limits: { messageCount: 5000, accountCount: 3 },
      features: { aiAccess: true },
      sortOrder: 2,
    });

    console.log('✅ Plans Created.');

    // 2. اعطای اشتراک به کاربر ادمین (شماره خودت رو بذار)
    // اگر کاربر با این شماره داری، بهش اشتراک Pro میده
    const myPhone = '09122270114';
    const user = await User.findOne({ phone: myPhone });

    if (user) {
      // حذف اشتراک‌های قبلی
      await Subscription.deleteMany({ user_id: user._id });

      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);

      await Subscription.create({
        user_id: user._id,
        plan_id: proPlan._id,
        currentLimits: proPlan.limits, // اسنپ‌شات لیمیت
        currentFeatures: proPlan.features,
        endDate: endDate,
        status: 'active',
      });
      console.log(`✅ Given PRO subscription to ${user.name || user.phone}`);
    } else {
      console.log('⚠️ User not found. Please login via panel first.');
    }

    process.exit();
  });
