// models/InstagramComment.js
const mongoose = require('mongoose');

const instagramCommentSchema = new mongoose.Schema({
  commentId: String,
  parentId: String,
  text: String,
  mediaId: String,
  mediaType: String,
  from: {
    id: String,
    username: String,
  },
  aiReply: {
    text: String,
    repliedAt: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: Date,
});

module.exports = mongoose.model('InstagramComment', instagramCommentSchema);
