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
let dotenv = require('dotenv').config();
const axios = require('axios'); // must be imported

app.set('port', process.env.PORT || 3004);
app.listen(app.get('port'));
const cors = require('cors');
// Allow requests from Vite frontend
app.use(
  cors({
    origin: '*',
    credentials: true,
  })
);

app.use(
  xhub({ algorithm: 'sha1', secret: process.env.INSTAGRAM_CLIENT_SECRET })
);
app.use(bodyParser.json());

const db = require('./models/index.js');
const { mongoose } = require('./models/index.js');

db.mongoose
  .connect(
    `mongodb+srv://vahid_:${process.env.MONGODB_PASS}@cluster0.minxf.mongodb.net/${process.env.MONGODB_DB}`,
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  )
  .then(() => {
    console.log('Successfully connect to MongoDB.');
  })
  .catch((err) => {
    console.error('Connection error', err);
    process.exit();
  });

const Auth = require('./routes/auth');
const Accounts = require('./routes/accounts.js');

app.use('/auth', Auth);
app.use('/accounts', Accounts);

var token = process.env.TOKEN || 'token';
var received_updates = [];

app.get('/', function (req, res) {
  console.log(req);
  res.send(
    '<pre>' + JSON.stringify(received_updates, null, 2) + '</pre>' || 'Hi'
  );
});

app.get(['/facebook', '/instagram', '/threads'], function (req, res) {
  if (
    req.query['hub.mode'] == 'subscribe' &&
    req.query['hub.verify_token'] == token
  ) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(400);
  }
});

app.post('/facebook', function (req, res) {
  console.log('Facebook request body:', req.body);

  if (!req.isXHubValid()) {
    console.log(
      'Warning - request header X-Hub-Signature not present or invalid'
    );
    res.sendStatus(401);
    return;
  }

  console.log('request header X-Hub-Signature validated');
  // Process the Facebook updates here
  received_updates.unshift(req.body);
  res.sendStatus(200);
});

// app.post('/instagram', function (req, res) {
//   console.log('Instagram request body:');
//   // Process the Instagram updates here
//   received_updates.unshift(req.body);
//   res.sendStatus(200);
// });

app.post('/instagram', async function (req, res) {
  console.log('📬 Webhook POST /instagram triggered');
  console.log(
    '✅ Full Instagram Webhook Payload:',
    JSON.stringify(req.body, null, 2)
  );

  if (!req.isXHubValid()) {
    console.log('⛔ Invalid X-Hub signature');
    return res.sendStatus(401);
  }

  const entries = req.body.entry || [];
  console.log('📜 Entries:', JSON.stringify(entries, null, 2));
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      console.log('➡️ Checking change field:', change.field);
      console.log('🔍 Change object:', JSON.stringify(change, null, 2));

      const { field, value } = change;

      if (field === 'comments' || field === 'live_comments') {
        const comment = value;

        const aiPayload = {
          userId: entry.id, // Use entry.id as userId
          igAccountId: entry.id,
          eventType: 'comment',
          eventPayload: {
            text: comment.text,
            id: comment.id,
            from: comment.from,
          },
        };

        console.log('🤖 AI Payload:', JSON.stringify(aiPayload, null, 2));

        try {
          const response = await axios.post(
            'https://mcp.vahidafshari.com/webhook/ig-ai-reply',
            aiPayload
          );
          console.log('✅ Sent to n8n. AI response:', response.data);
          const aiReply = response.data;
          console.log('🤖 AI response:', aiReply);

          // Reply to comment using Instagram Graph API
          const replyRes = await axios.post(
            `https://graph.instagram.com/v23.0/${comment.id}/replies`,
            {
              message: aiReply,
            },
            {
              headers: {
                'Content-Type': 'application/json',
              },
              params: {
                access_token: process.env.IG_USER_TOKEN, // Use your token securely
              },
            }
          );

          console.log(
            '✅ Successfully replied to comment:',
            replyRes.data,
            comment.id
          );
          return res.status(200).json({ success: true, aiReply });
        } catch (err) {
          console.error(
            '❌ Error sending to n8n:',
            err.response?.data || err.message
          );
        }
      } else {
        console.log('ℹ️ No comment field in payload.');
        console.log(
          '🔍 Change object without comment field:',
          JSON.stringify(change, null, 2)
        );
      }
    }
  }

  res.sendStatus(200);
});

app.post('/threads', function (req, res) {
  console.log('Threads request body:');
  console.log(req.body);
  // Process the Threads updates here
  received_updates.unshift(req.body);
  res.sendStatus(200);
});

app.post('/api/ai/reply/test', async (req, res) => {
  const { igAccountId, eventType, eventPayload, userId } = req.body;

  // Optional: Fetch long-lived access token from your DB
  const accessToken = await db.getAccessTokenForUser(userId);

  try {
    const response = await axios.post(
      'https://mcp.vahidafshari.com/webhook/ig-ai-reply',
      {
        igAccountId,
        userId,
        accessToken,
        eventType,
        eventPayload,
      }
    );

    res.status(200).json({ success: true, aiReply: response.data });
  } catch (err) {
    console.error('Error forwarding to n8n:', err);
    res.status(500).json({ error: 'Failed to send to n8n' });
  }
});
