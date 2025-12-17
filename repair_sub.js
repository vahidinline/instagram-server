const mongoose = require('mongoose');
const User = require('./models/User');
const Plan = require('./models/Plan');
const Subscription = require('./models/Subscription');
require('dotenv').config();

mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`
  )
  .then(async () => {
    console.log('🔌 Connected. Repairing Subscription...');

    // 1. پیدا کردن کاربر (با شماره موبایلی که با آن لاگین هستید)
    // *** شماره خودتان را اینجا دقیق وارد کنید ***
    const MY_PHONE = '09127698244';

    const user = await User.findOne({ phone: MY_PHONE });
    if (!user) {
      console.error(`❌ User with phone ${MY_PHONE} not found!`);
      process.exit();
    }
    console.log(`👤 User Found: ${user.name} (${user._id})`);

    // 2. پیدا کردن پلن حرفه‌ای سالم
    const proPlan = await Plan.findOne({ slug: 'pro_monthly' });
    if (!proPlan) {
      console.error('❌ Pro Plan not found! Run seed_plans.js first.');
      process.exit();
    }
    console.log(`💎 Plan Found: ${proPlan.name} (${proPlan._id})`);

    // 3. حذف اشتراک‌های خراب قبلی
    await Subscription.deleteMany({ user_id: user._id });
    console.log('🗑️ Old subscriptions deleted.');

    // 4. ایجاد اشتراک سالم جدید
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    await Subscription.create({
      user_id: user._id,
      plan_id: proPlan._id,
      currentLimits: proPlan.limits, // کپی کردن لیمیت‌ها از پلن جدید
      currentFeatures: proPlan.features,
      endDate: endDate,
      status: 'active',
      usage: {
        messagesUsed: 0,
        accountsUsed: 0,
      },
    });

    console.log('✅ New Subscription Created Successfully.');
    console.log('👉 Now refresh your panel dashboard.');
    process.exit();
  })
  .catch((err) => console.error(err));
