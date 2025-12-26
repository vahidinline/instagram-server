/**
 * Main Server File - FINAL INTEGRATED VERSION (With Redis Queue)
 */

require('dotenv').config();

// Patch for Crypto
const crypto = require('crypto');
if (!global.crypto) {
  global.crypto = crypto;
}

const express = require('express');
const bodyParser = require('body-parser');
const xhub = require('express-x-hub');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

// *** تغییر ۱: ایمپورت کردن هندلر صف به جای پردازشگر مستقیم ***
// const processor = require('./services/webhookProcessor'); // <--- حذف شد (چون ورکر صدا میزند)
const queueHandler = require('./services/queueHandler'); // <--- اضافه شد

// Database Connection
const db = require('./models/index.js');
db.mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`,
    { useNewUrlParser: true, useUnifiedTopology: true }
  )
  .then(() => console.log('✅ MongoDB Connected Successfully.'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

const app = express();
const server = http.createServer(app);

// Socket.io Setup
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});
global.io = io;

app.set('port', process.env.PORT || 3004);

// Middlewares
app.use(cors({ origin: '*', credentials: true }));
app.use(
  xhub({ algorithm: 'sha1', secret: process.env.INSTAGRAM_CLIENT_SECRET })
);
app.use(bodyParser.json());
app.use(express.static('public'));
// --- ROUTES IMPORTS ---
const userAuthRoutes = require('./routes/userAuth');
const instagramAuthRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const triggerRoutes = require('./routes/triggers');
const flowRoutes = require('./routes/flows');
const analyticsRoutes = require('./routes/analytics');
const inboxRoutes = require('./routes/inbox');
const paymentRoutes = require('./routes/payment');
const knowledgeRoutes = require('./routes/knowledge');
const leadsRoutes = require('./routes/leads');
const personaRoutes = require('./routes/personas');
const demoRoutes = require('./routes/demo');
const mediaRoutes = require('./routes/media');
const adminRoutes = require('./routes/admin');
const campaignRoutes = require('./routes/campaigns');
const supportRoutes = require('./routes/support');
const channelsRoutes = require('./routes/channels');
// --- API ENDPOINTS ---
app.use('/api/auth', userAuthRoutes);
app.use('/auth', instagramAuthRoutes);
app.use('/accounts', accountRoutes);
app.use('/api/triggers', triggerRoutes);
app.use('/api/flows', flowRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/personas', personaRoutes);
app.use('/api/demo', demoRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/channels', channelsRoutes);

// --- WEBHOOK VERIFICATION ---
app.get('/instagram', function (req, res) {
  if (
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  ) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(400);
  }
});

// --- WEBHOOK HANDLER (Asynchronous Queue) ---
app.post('/instagram', async function (req, res) {
  // 1. پاسخ سریع به متا (Fast ACK)
  // این مهمترین بخش برای هندل کردن ترافیک بالاست
  res.sendStatus(200);

  const body = req.body;
  if (body.object === 'instagram') {
    for (const entry of body.entry) {
      // 2. افزودن به صف به جای پردازش مستقیم

      // الف: پیام‌های دایرکت
      if (entry.messaging) {
        for (const event of entry.messaging) {
          // *** تغییر: استفاده از صف ***
          await queueHandler.addToQueue('message', entry, event);
        }
      }

      // ب: پیام‌های استندبای
      if (entry.standby) {
        for (const event of entry.standby) {
          // *** تغییر: استفاده از صف ***
          await queueHandler.addToQueue('standby', entry, event);
        }
      }

      // ج: کامنت‌ها
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === 'comments') {
            // *** تغییر: استفاده از صف ***
            await queueHandler.addToQueue('comment', entry, change);
          }
        }
      }
    }
  }
});

// --- SOCKET CONNECTION ---
io.on('connection', (socket) => {
  socket.on('join_room', (room) => {
    socket.join(room);
    console.log(`🔌 Socket ${socket.id} joined room: ${room}`);
  });
});

app.get('/', (req, res) => res.send('Server is Running with Redis Queue 🐇'));

server.listen(app.get('port'), () => {
  console.log(`🚀 Server listening on port ${app.get('port')}`);
});
