const mongoose = require('mongoose');
const Plan = require('./models/Plan');
const Subscription = require('./models/Subscription');
require('dotenv').config();

mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`
  )
  .then(async () => {
    console.log('🔌 Connected. Updating Limits...');

    // آپدیت پلن Pro
    await Plan.updateMany(
      { slug: 'pro_monthly' },
      { $set: { 'limits.aiTokenLimit': 50000 } }
    );
    // آپدیت پلن Free
    await Plan.updateMany(
      { slug: 'free_trial' },
      { $set: { 'limits.aiTokenLimit': 1000 } }
    );

    // آپدیت تمام اشتراک‌های فعال
    await Subscription.updateMany(
      {},
      {
        $set: {
          'currentLimits.aiTokenLimit': 50000, // مقدار پیش‌فرض
          'usage.aiTokensUsed': 0,
        },
      }
    );

    console.log('✅ Limits Updated.');
    process.exit();
  });
