const mongoose = require('mongoose');

const IGConnectionsSchema = new mongoose.Schema({
  app_userId: {
    type: String,
    required: true,
    index: true, // ایندکس باشد اما unique نباشد
    // unique: true  <--- این خط نباید باشد!
  },
  ig_userId: {
    type: String,
    required: true,
    unique: true, // اکانت اینستاگرام باید یکتا باشد
  },
  username: String,
  account_name: String,
  profile_picture_url: String,
  access_token: { type: String, required: true },
  token_expires_at: Date,
  account_status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active',
  },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('IGConnections', IGConnectionsSchema);
