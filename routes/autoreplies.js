// routes/autoReplies.ts
const express = require('express');
const AutoReply = require('../models/AutoReply');
const router = express.Router();

router.get('/', async (req, res) => {
  const { account_id } = req.query;
  const filter = account_id ? { account_id } : {};
  const replies = await AutoReply.find(filter).sort({ created_at: -1 });
  res.json(replies);
});

router.post('/', async (req, res) => {
  const newReply = new AutoReply(req.body);
  await newReply.save();
  res.json(newReply);
});

// PUT /auto-replies/:id
// DELETE /auto-replies/:id
// PATCH /auto-replies/:id/toggle

export default router;
