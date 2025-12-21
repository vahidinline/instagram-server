const express = require('express');
const router = express.Router();
const Persona = require('../models/Persona');
const authMiddleware = require('../middleware/auth');
const { buildSystemPrompt } = require('../utils/promptBuilder'); // <--- ایمپورت جدید

// 1. دریافت لیست
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

// 2. ساخت پرسونا (هوشمند)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, gender, avatar, config } = req.body;

    // ساخت خودکار پرامپت بر اساس تنظیمات
    const generatedPrompt = buildSystemPrompt(name, gender, config);

    const newPersona = await Persona.create({
      user_id: req.user.id,
      name,
      gender,
      avatar,
      config, // ذخیره تنظیمات برای ویرایش بعدی
      systemPrompt: generatedPrompt, // ذخیره پرامپت نهایی برای استفاده
      isSystem: false,
    });

    res.json(newPersona);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. ویرایش پرسونا (PUT) - جدید
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { name, gender, avatar, config } = req.body;

    // بازسازی پرامپت
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

// 4. حذف
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

module.exports = router;
