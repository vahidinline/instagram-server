const mongoose = require('mongoose');

const TriggerSchema = new mongoose.Schema({
  // The App User who owns this trigger
  app_userId: { type: String, required: true },
  // The specific IG Page ID this trigger applies to
  ig_accountId: { type: String, required: true },
  keyword: { type: String, required: true, lowercase: true },
  match_type: {
    type: String,
    enum: ['exact', 'contains', 'starts_with'],
    default: 'contains',
  },
  response_text: { type: String, required: true },
  is_active: { type: Boolean, default: true },
  type: { type: String, enum: ['dm', 'comment', 'both'], default: 'both' },
});

module.exports = mongoose.model('Triggers', TriggerSchema);
