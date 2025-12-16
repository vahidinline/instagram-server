const mongoose = require('mongoose');
const Triggers = require('./models/Triggers'); // مطمئن شو مسیر و نام فایل درسته
require('dotenv').config();

const YOUR_IG_ID = '17841400768458925'; // آی‌دی شما از دیتابیس

mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`
  )
  .then(async () => {
    console.log('🔌 Connected. Seeding...');

    // 1. پاک کردن تریگرهای قبلی
    // اگر باز هم ارور داد، این خط رو کامنت کن و دستی پاک کن
    try {
      await Triggers.deleteMany({ ig_accountId: YOUR_IG_ID });
      console.log('🗑️  Old triggers cleared.');
    } catch (e) {
      console.log('⚠️ Delete skipped:', e.message);
    }

    // 2. ساخت تریگر جدید
    await Triggers.create({
      app_userId: 'admin_test',
      ig_accountId: YOUR_IG_ID,
      keyword: 'سلام',
      match_type: 'contains',
      response_text:
        'سلام وحید جان! 😍 سیستم هوشمند شما با موفقیت وصل شد و داره پاسخ میده!',
      is_active: true,
      type: 'dm',
    });

    console.log('✅ Trigger Created Successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
