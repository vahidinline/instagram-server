const express = require('express');
const router = express.Router();
const Flows = require('../models/Flows');

// لیست فلوها
router.get('/', async (req, res) => {
  try {
    const { ig_accountId } = req.query;
    const flows = await Flows.find({ ig_accountId }).sort({ created_at: -1 });
    res.json(flows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ساخت فلو جدید
router.post('/', async (req, res) => {
  try {
    const { ig_accountId, name, messages } = req.body;
    const newFlow = await Flows.create({ ig_accountId, name, messages });
    res.json(newFlow);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// حذف فلو
router.delete('/:id', async (req, res) => {
  try {
    await Flows.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
