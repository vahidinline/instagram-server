const IORedis = require('ioredis');
const url = require('url');

const connectionString =
  process.env.REDIS_CONNECTION_STRING || 'redis://localhost:6379';

console.log('🔌 Initializing Redis Configuration...');

let connection;

// تنظیمات اجباری برای BullMQ (این آبجکت باید در تمام حالت‌ها اعمال شود)
const bullMqRequirements = {
  maxRetriesPerRequest: null, // <--- حیاتی: حتماً باید null باشد (نه عدد)
  enableReadyCheck: false,
};

if (!connectionString) {
  console.error('❌ REDIS_CONNECTION_STRING is missing.');
  // یک کانکشن دام برای جلوگیری از کرش
  connection = new IORedis({ ...bullMqRequirements, lazyConnect: true });
} else {
  try {
    // تشخیص نوع اتصال (آژور/لوکال)
    if (connectionString.startsWith('rediss://')) {
      // --- حالت آژور (SSL) ---
      const redisUrl = new url.URL(connectionString);

      const redisOptions = {
        host: redisUrl.hostname,
        port: Number(redisUrl.port) || 6380,
        password: redisUrl.password,
        username: redisUrl.username || undefined,

        // تنظیمات شبکه آژور
        family: 4,
        tls: {
          servername: redisUrl.hostname,
          rejectUnauthorized: false,
        },

        // تنظیمات تایم‌اوت
        connectTimeout: 30000,
        keepAlive: 10000,

        // *** اعمال تنظیمات BullMQ ***
        ...bullMqRequirements,
      };

      console.log(`🎯 Connecting to Azure Redis: ${redisOptions.host}`);
      connection = new IORedis(redisOptions);
    } else {
      // --- حالت لوکال (Standard) ---
      console.log(`🎯 Connecting to Local Redis: ${connectionString}`);

      connection = new IORedis(connectionString, {
        // *** اعمال تنظیمات BullMQ ***
        ...bullMqRequirements,

        retryStrategy(times) {
          return Math.min(times * 50, 2000);
        },
      });
    }
  } catch (parseError) {
    console.error('❌ Error parsing Redis URL:', parseError.message);
    connection = new IORedis({ ...bullMqRequirements, lazyConnect: true });
  }
}

connection.on('connect', () => console.log('✅ Redis Connected Successfully!'));
connection.on('error', (err) => {
  // لاگ کردن خطا بدون کرش
  console.error('❌ Redis Connection Error:', err.message);
});

module.exports = connection;
