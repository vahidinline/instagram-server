const express = require('express');
const router = express.Router();
const Persona = require('../models/Persona');
const authMiddleware = require('../middleware/auth');
const azureService = require('../services/azureService'); // <--- ✅ ایمپورت حیاتی
const { buildSystemPrompt } = require('../utils/promptBuilder');

// 1. دریافت لیست پرسوناها
router.get('/', authMiddleware, async (req, res) => {
  try {
    const personas = await Persona.find({
      $or: [{ isSystem: true }, { user_id: req.user.id }],
    }).sort({ isSystem: -1, created_at: -1 });

    res.json(personas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. ساخت پرسونا
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, gender, avatar, config } = req.body;

    const generatedPrompt = buildSystemPrompt(name, gender, config);

    const newPersona = await Persona.create({
      user_id: req.user.id,
      name,
      gender,
      avatar,
      config,
      systemPrompt: generatedPrompt,
      isSystem: false,
    });

    res.json(newPersona);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. ویرایش پرسونا
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { name, gender, avatar, config } = req.body;

    const generatedPrompt = buildSystemPrompt(name, gender, config);

    const updatedPersona = await Persona.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user.id },
      { name, gender, avatar, config, systemPrompt: generatedPrompt },
      { new: true }
    );

    if (!updatedPersona)
      return res.status(404).json({ error: 'Persona not found' });
    res.json(updatedPersona);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. حذف پرسونا
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await Persona.findOneAndDelete({
      _id: req.params.id,
      user_id: req.user.id,
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. آنالیز لحن (Tone Cloning)
router.post('/analyze-tone', authMiddleware, async (req, res) => {
  try {
    const { samples } = req.body;

    if (!samples || samples.length < 2) {
      return res.status(400).json({ error: 'حداقل ۲ نمونه متن لازم است.' });
    }

    // فراخوانی متد جدید در سرویس آژور
    const generatedPrompt = await azureService.analyzeTone(samples);

    res.json({ systemPrompt: generatedPrompt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
