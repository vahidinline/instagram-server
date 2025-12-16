const mongoose = require('mongoose');
require('dotenv').config();

mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`
  )
  .then(async () => {
    console.log('🔌 Connected to DB...');

    const collection = mongoose.connection.collection('igconnections');

    try {
      // تلاش برای حذف ایندکس مزاحم
      // معمولا اسمش app_userId_1 است (طبق ارور شما)
      await collection.dropIndex('app_userId_1');
      console.log('✅ Index "app_userId_1" dropped successfully!');
    } catch (e) {
      console.log('⚠️ Index drop info:', e.message);
      console.log('NOTE: If it says "index not found", it is already fixed.');
    }

    console.log('🚀 DB is now ready for multi-account login.');
    process.exit();
  })
  .catch((err) => {
    console.error('❌ Connection Error:', err);
    process.exit(1);
  });
