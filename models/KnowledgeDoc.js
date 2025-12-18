const mongoose = require('mongoose');

const KnowledgeDocSchema = new mongoose.Schema({
  ig_accountId: { type: String, required: true, index: true },
  fileName: { type: String, required: true },
  fileType: { type: String, enum: ['pdf', 'txt', 'manual'], default: 'manual' },
  azureDocId: { type: String }, // شناسه داکیومنت در آژور (برای حذف کردن)
  status: { type: String, enum: ['indexed', 'failed'], default: 'indexed' },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('KnowledgeDoc', KnowledgeDocSchema);
