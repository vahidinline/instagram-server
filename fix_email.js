const mongoose = require('mongoose');
require('dotenv').config();

mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`
  )
  .then(async () => {
    console.log('🔌 Connected to DB...');

    const collection = mongoose.connection.collection('users');

    try {
      // حذف ایندکس مزاحم ایمیل
      await collection.dropIndex('email_1');
      console.log('✅ Index "email_1" dropped successfully!');
    } catch (e) {
      console.log('ℹ️ Info:', e.message);
    }

    console.log('🚀 Database fixed. Now you can login with mobile.');
    process.exit();
  })
  .catch((err) => {
    console.error('❌ Connection Error:', err);
    process.exit(1);
  });
