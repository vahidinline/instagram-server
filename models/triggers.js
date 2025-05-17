const mongoose = require('mongoose');

const TriggersSchema = new mongoose.Schema({
  accountId: {
    type: String,
    required: true,
    unique: true,
  },
  name: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  status: {
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

// Update modified_at field before saving
TriggersSchema.pre('save', function (next) {
  this.modified_at = Date.now();
  next();
});

module.exports = mongoose.model('Triggers', TriggersSchema);
