const mongoose = require('mongoose');

const TicketSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  subject: { type: String, required: true }, // عنوان (مثلاً: مشکل در اتصال)
  status: {
    type: String,
    enum: ['open', 'admin_replied', 'user_replied', 'closed'],
    default: 'open',
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  },

  // تاریخچه پیام‌های تیکت
  messages: [
    {
      sender: { type: String, enum: ['user', 'admin', 'ai'], required: true },
      content: { type: String, required: true },
      created_at: { type: Date, default: Date.now },
    },
  ],

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Ticket', TicketSchema);
