const mongoose = require('mongoose');

const IGAcoountSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
  },
  account_name: {
    type: String,
    required: true,
  },
  profile_picture_url: {
    type: String,
    required: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  modified_at: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('IGAcoount', IGAcoountSchema);
