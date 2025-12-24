const IORedis = require('ioredis');
const url = require('url');

const connectionString = process.env.REDIS_CONNECTION_STRING;

console.log('🔌 Initializing Redis Configuration (Strict Mode)...');

let connection;

// تنظیمات مشترک و اجباری BullMQ
const commonOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 10000,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    console.log(`♻️ Redis Retry Attempt: ${times}`);
    return delay;
  },
};

if (!connectionString) {
  console.error('❌ REDIS_CONNECTION_STRING is missing.');
  connection = new IORedis({ lazyConnect: true, ...commonOptions });
} else {
  try {
    const redisUrl = new url.URL(connectionString);

    // تشخیص اینکه آیا کاربر SSL خواسته یا نه
    // redis: = بدون SSL (پورت 6379)
    // rediss: = با SSL (پورت 6380)
    const useTLS = redisUrl.protocol === 'rediss:';

    console.log(
      `🎯 Config detected: Protocol=${redisUrl.protocol}, Port=${
        redisUrl.port || (useTLS ? 6380 : 6379)
      }`
    );

    const redisOptions = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || (useTLS ? 6380 : 6379),
      password: redisUrl.password,
      username: redisUrl.username || undefined,
      family: 4, // اجبار به IPv4 برای آژور
      ...commonOptions,
    };

    // *** نکته حیاتی: فقط اگر rediss بود، آبجکت tls را اضافه کن ***
    if (useTLS) {
      console.log('🔒 Enabling TLS/SSL mode...');
      redisOptions.tls = {
        servername: redisUrl.hostname,
        rejectUnauthorized: false,
      };
    } else {
      console.log('🔓 Using Non-SSL mode (Standard)...');
      // هیچ چیزی به نام tls نباید در آپشن‌ها باشد، حتی null
      delete redisOptions.tls;
    }

    connection = new IORedis(redisOptions);
  } catch (parseError) {
    console.error('❌ Error parsing Redis URL:', parseError.message);
    connection = new IORedis({ lazyConnect: true, ...commonOptions });
  }
}

connection.on('connect', () => console.log('✅ Redis Connected Successfully!'));
connection.on('error', (err) => {
  // فقط لاگ کن و نگذار سرور کرش کند
  console.error('❌ Redis Error:', err.message);
});

module.exports = connection;
