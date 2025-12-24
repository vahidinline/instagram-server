const processor = require('./webhookProcessor');

// صف ساده در حافظه (آرایه)
const memoryQueue = [];
let isProcessing = false;

/**
 * تابع افزودن به صف (دقیقاً مثل قبل صدا زده می‌شود)
 */
const addToQueue = async (type, entry, event) => {
  console.log(`📥 Added to Memory Queue: ${type}`);
  memoryQueue.push({ type, entry, event });

  // اگر ورکر بیکار است، روشنش کن
  if (!isProcessing) {
    processQueue();
  }
};

/**
 * ورکر داخلی (Loop)
 */
const processQueue = async () => {
  if (isProcessing) return;
  isProcessing = true;

  while (memoryQueue.length > 0) {
    const job = memoryQueue.shift(); // برداشتن اولین آیتم

    try {
      console.log(`⚙️ Processing Memory Job: ${job.type}`);

      if (job.type === 'message' || job.type === 'standby') {
        await processor.handleMessage(job.entry, job.event);
      } else if (job.type === 'comment') {
        await processor.handleComment(job.entry, job.event);
      }
    } catch (error) {
      console.error(`❌ Job Failed:`, error.message);
      // در حافظه، Retry پیچیده است، پس فقط لاگ می‌کنیم و ادامه می‌دهیم
    }
  }

  isProcessing = false;
  console.log('✅ Queue Drained (Idle).');
};

module.exports = { addToQueue };
