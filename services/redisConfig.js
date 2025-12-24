const IORedis = require('ioredis');
const url = require('url');

const connectionString =
  process.env.REDIS_CONNECTION_STRING || 'redis://localhost:6379';

console.log('🔌 Connecting to Redis...');

// استخراج Hostname برای تنظیمات TLS آژور
let tlsOptions = undefined;
if (connectionString.startsWith('rediss://')) {
  try {
    const parsedUrl = new url.URL(connectionString);
    tlsOptions = {
      servername: parsedUrl.hostname, // <--- این خط برای آژور حیاتی است
    };
  } catch (e) {
    console.error('URL Parse Error:', e);
  }
}

const connection = new IORedis(connectionString, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  // تنظیمات اتصال مجدد
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
  // تنظیمات TLS اصلاح شده
  tls: tlsOptions,
  // تنظیمات تایم‌اوت
  connectTimeout: 10000, // 10 ثانیه صبر کن
});

connection.on('connect', () => console.log('✅ Redis Connected Successfully!'));
connection.on('error', (err) => {
  // جلوگیری از کرش کردن سرور با لاگ کردن ارور
  console.error('❌ Redis Connection Error:', err.message);
});

module.exports = connection;
