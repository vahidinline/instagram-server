const mongoose = require('mongoose');

const IGConnections = new mongoose.Schema({
  app_userId: {
    type: String,
    required: true,
    unique: true,
  },
  ig_userId: {
    type: String,
    required: true,
  },
  profile_picture_url: {
    type: String,
    required: true,
  },
  access_token: {
    type: String,
    required: true,
  },
  token_expires_at: {
    type: Date,
    default: Date.now,
  },
  token_created_at: {
    type: Date,
    default: Date.now,
  },
  last_update: {
    type: Date,
    default: Date.now,
  },
  account_name: {
    type: String,
    required: true,
  },
});

module.exports = mongoose.model('IGConnections', IGConnections);
