require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const xhub = require('express-x-hub');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const processor = require('./services/webhookProcessor');

const app = express();
const server = http.createServer(app);

// تنظیمات سوکت
const io = new Server(server, {
  cors: {
    origin: '*', // اجازه به همه دامین‌ها
    methods: ['GET', 'POST'],
  },
});

// ذخیره io در متغیر جهانی
global.io = io;

app.set('port', process.env.PORT || 3004);

app.use(cors({ origin: '*', credentials: true }));
app.use(
  xhub({ algorithm: 'sha1', secret: process.env.INSTAGRAM_CLIENT_SECRET })
);
app.use(bodyParser.json());

// Database
const db = require('./models/index.js');
db.mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`
  )
  .then(() => console.log('✅ MongoDB Connected.'));

// --- ROUTES ---
// 1. روت احراز هویت کاربر (پیامک/لاگین) - این خط جا افتاده بود 👇
app.use('/api/auth', require('./routes/userAuth'));

// 2. سایر روت‌ها
app.use('/auth', require('./routes/auth')); // اینستاگرام OAuth
app.use('/accounts', require('./routes/accounts.js'));
app.use('/api/triggers', require('./routes/triggers'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/flows', require('./routes/flows'));
app.use('/api/inbox', require('./routes/inbox'));

// مدیریت اتصال کلاینت‌ها به سوکت
io.on('connection', (socket) => {
  console.log('🔌 Client Connected to Socket:', socket.id);

  socket.on('join_room', (ig_accountId) => {
    socket.join(ig_accountId);
    console.log(`Socket ${socket.id} joined room: ${ig_accountId}`);
  });
});

// Webhook Verification
app.get('/instagram', (req, res) => {
  if (
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  ) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(400);
  }
});

// Webhook Handler
app.post('/instagram', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;
  if (body.object === 'instagram') {
    for (const entry of body.entry) {
      if (entry.messaging) {
        for (const event of entry.messaging)
          await processor.handleMessage(entry, event);
      }
      // هندل کردن استندبای و کامنت‌ها در صورت نیاز
    }
  }
});

server.listen(app.get('port'), () => {
  console.log(`🚀 Server & Socket running on port ${app.get('port')}`);
});
