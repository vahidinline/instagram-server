/**
 * Main Server File - Final Fixed Version
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const xhub = require('express-x-hub');
const cors = require('cors');

// Import the Webhook Processor
const processor = require('./services/webhookProcessor');

const app = express();

app.set('port', process.env.PORT || 3004);

// Allow requests
app.use(cors({ origin: '*', credentials: true }));

// X-Hub Signature Verification
app.use(
  xhub({ algorithm: 'sha1', secret: process.env.INSTAGRAM_CLIENT_SECRET })
);

app.use(bodyParser.json());

// Database Connection
const db = require('./models/index.js');
db.mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`,
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  )
  .then(() => {
    console.log('✅ Successfully connected to MongoDB.');
  })
  .catch((err) => {
    console.error('❌ MongoDB Connection error', err);
    process.exit();
  });

// --- Routes Import ---
const Auth = require('./routes/auth');
const Accounts = require('./routes/accounts.js');
const triggerRoutes = require('./routes/triggers');
const analyticsRoutes = require('./routes/analytics');
const flowRoutes = require('./routes/flows'); // <--- ✅ اضافه شد (قبلاً نبود)

// --- API Endpoints ---
app.use('/auth', Auth);
app.use('/accounts', Accounts);
app.use('/api/triggers', triggerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/flows', flowRoutes); // <--- ✅ اضافه شد (مسیر فلوها فعال شد)

// -----------------------------------------------------------------------
// 1. WEBHOOK VERIFICATION (GET)
// -----------------------------------------------------------------------
app.get('/instagram', function (req, res) {
  console.log('🔍 Incoming Webhook Verification Request');

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const MY_VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;

  if (mode && token) {
    if (mode === 'subscribe' && token === MY_VERIFY_TOKEN) {
      console.log('✅ Webhook Verified Successfully!');
      res.status(200).send(challenge);
    } else {
      console.error('❌ Verification Failed: Token mismatch.');
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// -----------------------------------------------------------------------
// 2. WEBHOOK EVENT HANDLING (POST)
// -----------------------------------------------------------------------
app.post('/instagram', async function (req, res) {
  res.sendStatus(200);

  const body = req.body;

  if (body.object === 'instagram') {
    for (const entry of body.entry) {
      if (entry.messaging) {
        for (const event of entry.messaging) {
          console.log('📨 Mode: Messaging (Primary)');
          await processor.handleMessage(entry, event);
        }
      }
      if (entry.standby) {
        for (const event of entry.standby) {
          console.log('💤 Mode: Standby (Secondary)');
          await processor.handleMessage(entry, event);
        }
      }
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === 'comments' || change.field === 'live_comments') {
            await processor.handleComment(entry, change);
          } else if (change.field === 'messages') {
            const simulatedEvent = {
              sender: change.value.sender || { id: 'test_sender' },
              recipient: change.value.recipient || { id: 'test_recipient' },
              message: change.value.message,
            };
            await processor.handleMessage(entry, simulatedEvent);
          }
        }
      }
    }
  }
});

app.get('/', function (req, res) {
  res.send('Instagram Webhook Server Running 🚀');
});

app.listen(app.get('port'), () => {
  console.log(`Server is listening on port ${app.get('port')}`);
});
