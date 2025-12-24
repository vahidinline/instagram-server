const { Queue, Worker } = require('bullmq');
const connection = require('./redisConfig');
const processor = require('./webhookProcessor');

// 1. ساخت صف پیام‌ها
const messageQueue = new Queue('instagram-events', { connection });

// 2. تعریف ورکر (کارگر) برای پردازش صف
const worker = new Worker(
  'instagram-events',
  async (job) => {
    const { type, entry, event } = job.data;

    console.log(`⚙️ Processing Job ${job.id} type: ${type}`);

    try {
      if (type === 'message' || type === 'standby') {
        // فراخوانی پردازشگر اصلی دایرکت
        await processor.handleMessage(entry, event);
      } else if (type === 'comment') {
        // فراخوانی پردازشگر کامنت
        await processor.handleComment(entry, event);
      }
    } catch (error) {
      console.error(`❌ Job ${job.id} Failed:`, error.message);
      throw error; // تا BullMQ بفهمد و در صورت نیاز Retry کند
    }
  },
  {
    connection,
    concurrency: 10, // پردازش همزمان ۱۰ پیام (قابل افزایش)
    limiter: {
      max: 50, // حداکثر ۵۰ پیام
      duration: 1000, // در هر ثانیه (جلوگیری از بن شدن توسط متا)
    },
  }
);

// گوش دادن به رویدادهای ورکر
worker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} Completed.`);
});

worker.on('failed', (job, err) => {
  console.error(`🔥 Job ${job.id} Failed permanently: ${err.message}`);
});

// تابع افزودن به صف (که در index.js صدا زده می‌شود)
const addToQueue = async (type, entry, event) => {
  await messageQueue.add(
    'process-event',
    { type, entry, event },
    {
      removeOnComplete: true, // پاک کردن کارهای تمام شده برای سبک شدن ردیس
      removeOnFail: 500, // نگه داشتن ۵۰۰ خطای آخر
    }
  );
};

module.exports = { addToQueue };
