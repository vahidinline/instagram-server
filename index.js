/**
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

var bodyParser = require('body-parser');
var express = require('express');
var app = express();
var xhub = require('express-x-hub');
require('dotenv').config();
const cors = require('cors');

// Import the new Webhook Processor (Create this file as described below if you haven't)
const processor = require('./services/webhookProcessor');

app.set('port', process.env.PORT || 3004);
app.listen(app.get('port'), () => {
  console.log(`Server is listening on port ${app.get('port')}`);
});

// Allow requests from Vite frontend
app.use(
  cors({
    origin: '*',
    credentials: true,
  })
);

// X-Hub Signature Verification (Critical for Instagram Security)
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

// Routes
const Auth = require('./routes/auth');
const Accounts = require('./routes/accounts.js');
// const igComments = require('./funcs/IgComments.js'); // Deprecated in favor of webhookProcessor

app.use('/auth', Auth);
app.use('/accounts', Accounts);

// -----------------------------------------------------------------------
// 1. WEBHOOK VERIFICATION (GET)
// This is the specific fix for your deployment error.
// -----------------------------------------------------------------------
app.get('/instagram', function (req, res) {
  console.log('🔍 Incoming Webhook Verification Request:', req.query);

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Check your .env file for this variable!
  const MY_VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;

  if (mode && token) {
    if (mode === 'subscribe' && token === MY_VERIFY_TOKEN) {
      console.log('✅ Webhook Verified Successfully!');
      res.status(200).send(challenge);
    } else {
      console.error('❌ Verification Failed: Token mismatch.');
      console.error(`Expected: '${MY_VERIFY_TOKEN}', Received: '${token}'`);
      res.sendStatus(403);
    }
  } else {
    console.error('❌ Verification Failed: Missing parameters.');
    res.sendStatus(400);
  }
});

// -----------------------------------------------------------------------
// 2. WEBHOOK EVENT HANDLING (POST)
// This satisfies your requirement to identify triggers in DMs and Comments
// -----------------------------------------------------------------------
app.post('/instagram', async function (req, res) {
  console.log('📬 Webhook Event Received');

  if (!req.isXHubValid()) {
    console.log('⛔ Invalid X-Hub signature. Request ignored.');
    return res.sendStatus(401);
  }

  const body = req.body;

  if (body.object === 'instagram') {
    for (const entry of body.entry) {
      // 1. Handle Direct Messages (DMs)
      if (entry.messaging) {
        for (const messaging of entry.messaging) {
          console.log('📩 Processing DM Event...');
          try {
            await processor.handleMessage(entry, messaging);
          } catch (e) {
            console.error('Error processing message:', e.message);
          }
        }
      }

      // 2. Handle Comments
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === 'comments' || change.field === 'live_comments') {
            console.log('💬 Processing Comment Event...');
            try {
              await processor.handleComment(entry, change);
            } catch (e) {
              console.error('Error processing comment:', e.message);
            }
          }
        }
      }
    }
  }

  // Always return 200 OK to Meta quickly, or they will stop sending webhooks
  res.sendStatus(200);
});

// -----------------------------------------------------------------------
// Other Routes (Legacy/Testing)
// -----------------------------------------------------------------------
app.get('/', function (req, res) {
  res.send('Instagram Webhook Server Running');
});

app.post('/api/ai/reply/test', async (req, res) => {
  // Keep your existing test route logic if needed,
  // but updated to use the database correctly if you plan to use it.
  res.status(501).json({ message: 'Endpoint under maintenance' });
});
