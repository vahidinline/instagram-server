const IORedis = require('ioredis');

// دریافت کانکشن استرینگ از محیط
// مثال لوکال: redis://localhost:6379
// مثال آژور: rediss://:password@host:6380
const connectionString =
  process.env.REDIS_CONNECTION_STRING || 'redis://localhost:6379';

console.log('🔌 Connecting to Redis...');

// تنظیمات اتصال
const connection = new IORedis(connectionString, {
  maxRetriesPerRequest: null, // الزامی برای BullMQ
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  // تنظیمات TLS برای آژور (اگر پروتکل rediss باشد خودکار فعال میشود)
  tls: connectionString.startsWith('rediss') ? {} : undefined,
});

connection.on('connect', () => console.log('✅ Redis Connected!'));
connection.on('error', (err) => console.error('❌ Redis Error:', err.message));

module.exports = connection;
