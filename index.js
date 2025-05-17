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
app.set('port', process.env.PORT || 3004);
app.listen(app.get('port'));

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

app.post('/instagram', function (req, res) {
  console.log('Instagram request body:');
  console.log(req.body);
  // Process the Instagram updates here
  received_updates.unshift(req.body);
  res.sendStatus(200);
});

app.post('/threads', function (req, res) {
  console.log('Threads request body:');
  console.log(req.body);
  // Process the Threads updates here
  received_updates.unshift(req.body);
  res.sendStatus(200);
});
