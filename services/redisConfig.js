const IORedis = require('ioredis');
const url = require('url');
const dns = require('dns');
const net = require('net');
const tls = require('tls');

const connectionString = process.env.REDIS_CONNECTION_STRING;

console.log('🔌 Initializing Redis Configuration (Diagnostic Mode)...');

let connection;

// تنظیمات BullMQ
const bullMqRequirements = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

// --- توابع تست شبکه (عیب‌یابی) ---
function runDiagnostics(host, port, isTls) {
  console.log(`🕵️ DIAGNOSTIC: Starting checks for ${host}:${port}...`);

  // 1. تست DNS
  dns.lookup(host, (err, address, family) => {
    if (err) {
      console.error(
        `❌ DIAGNOSTIC DNS Error: Could not resolve ${host}`,
        err.code
      );
    } else {
      console.log(
        `✅ DIAGNOSTIC DNS Success: ${host} -> ${address} (IPv${family})`
      );

      // 2. تست اتصال TCP/TLS
      console.log(
        `🕵️ DIAGNOSTIC: Attempting raw ${
          isTls ? 'TLS' : 'TCP'
        } connection to ${address}:${port}...`
      );
      const socket = isTls
        ? tls.connect(port, address, { servername: host })
        : net.createConnection(port, address);

      socket.setTimeout(5000);

      socket.on('connect', () => {
        console.log(
          '✅ DIAGNOSTIC TCP/TLS Handshake Successful! (Network is OK)'
        );
        socket.end();
      });

      socket.on('secureConnect', () => {
        // مخصوص TLS
        console.log('✅ DIAGNOSTIC TLS Secure Connect Successful!');
        socket.end();
      });

      socket.on('timeout', () => {
        console.error(
          '❌ DIAGNOSTIC Socket Timeout: Firewall is blocking the connection.'
        );
        socket.destroy();
      });

      socket.on('error', (e) => {
        console.error(`❌ DIAGNOSTIC Socket Error: ${e.code} - ${e.message}`);
      });
    }
  });
}

if (!connectionString) {
  console.error('❌ REDIS_CONNECTION_STRING is missing.');
  connection = new IORedis({ ...bullMqRequirements, lazyConnect: true });
} else {
  try {
    const redisUrl = new url.URL(connectionString);
    const isTls = connectionString.startsWith('rediss://');

    // اجرای تست شبکه قبل از اتصال اصلی
    runDiagnostics(redisUrl.hostname, Number(redisUrl.port) || 6380, isTls);

    const redisOptions = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6380,
      password: redisUrl.password,
      username: redisUrl.username || undefined,

      family: 4,
      tls: isTls
        ? {
            servername: redisUrl.hostname,
            rejectUnauthorized: false, // برای تست سخت‌گیری SSL را کم می‌کنیم
          }
        : undefined,

      connectTimeout: 20000,
      keepAlive: 10000,
      retryStrategy(times) {
        const delay = Math.min(times * 500, 5000);
        console.log(`♻️ IORedis Retrying... Attempt ${times}`);
        return delay;
      },
      ...bullMqRequirements,
    };

    connection = new IORedis(redisOptions);
  } catch (parseError) {
    console.error('❌ Error parsing Redis URL:', parseError.message);
    connection = new IORedis({ ...bullMqRequirements, lazyConnect: true });
  }
}

connection.on('connect', () => console.log('✅ IORedis: Connected!'));
connection.on('ready', () => console.log('✅ IORedis: Ready!'));
connection.on('error', (err) => {
  // فقط لاگ کن، کرش نکن
  console.error(`❌ IORedis Runtime Error: ${err.message}`);
});

module.exports = connection;
