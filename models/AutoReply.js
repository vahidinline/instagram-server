// models/AutoReply.ts (Mongoose example)
import mongoose from 'mongoose';

const TriggerSchema = new mongoose.Schema({
  keyword: String,
  match_type: {
    type: String,
    enum: ['exact', 'contains', 'starts_with', 'ends_with'],
  },
});

const AutoReplySchema = new mongoose.Schema({
  account_id: String,
  name: String,
  type: { type: String, enum: ['dm', 'comment'] },
  message: String,
  is_active: Boolean,
  triggers: [TriggerSchema],
  created_at: { type: Date, default: Date.now },
});

export default mongoose.model('AutoReply', AutoReplySchema);
