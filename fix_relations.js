const mongoose = require('mongoose');
const User = require('./models/User');
const IGConnections = require('./models/IG-Connections');
const Subscription = require('./models/Subscription');
const Plan = require('./models/Plan');
require('dotenv').config();

mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`
  )
  .then(async () => {
    console.log('🔌 Connected. Fixing Database Relations...');

    // 1. پیدا کردن یک کاربر اصلی (یا اولین کاربر)
    const mainUser = await User.findOne({});
    if (!mainUser) {
      console.log('❌ No user found! Run app and register first.');
      process.exit();
    }

    console.log(
      `👤 Main User: ${mainUser.phone || mainUser.email} (${mainUser._id})`
    );

    // 2. وصل کردن تمام اکانت‌های اینستاگرام به این کاربر
    const updateResult = await IGConnections.updateMany(
      {},
      {
        $set: { user_id: mainUser._id },
      }
    );
    console.log(
      `🔗 Linked ${updateResult.modifiedCount} IG accounts to Main User.`
    );

    // 3. مطمئن شدن از وجود اشتراک برای این کاربر
    await Subscription.deleteMany({ user_id: mainUser._id }); // پاک کردن قبلی‌ها

    // پیدا کردن پلن
    const proPlan = await Plan.findOne({ slug: 'pro_monthly' });
    if (!proPlan) {
      console.log('❌ Plan not found. Run seed_plans.js first.');
      process.exit();
    }

    // ساخت اشتراک جدید
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    await Subscription.create({
      user_id: mainUser._id,
      plan_id: proPlan._id,
      currentLimits: proPlan.limits,
      currentFeatures: proPlan.features,
      endDate: endDate,
      status: 'active',
      usage: { messagesUsed: 0 },
    });

    console.log('✅ Created fresh Subscription for Main User.');
    console.log('🚀 READY TO TEST!');
    process.exit();
  });
