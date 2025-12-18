const express = require('express');
const router = express.Router();
const Persona = require('../models/Persona');
const authMiddleware = require('../middleware/auth');

// 1. دریافت لیست پرسوناها (سیستمی + شخصی کاربر)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const personas = await Persona.find({
      $or: [
        { isSystem: true }, // پرسوناهای عمومی
        { user_id: req.user.id }, // پرسوناهای اختصاصی این کاربر
      ],
    }).sort({ isSystem: -1, created_at: -1 }); // اول سیستمی‌ها

    res.json(personas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. ساخت پرسونای شخصی جدید
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, description, systemPrompt, icon } = req.body;

    const newPersona = await Persona.create({
      user_id: req.user.id,
      name,
      description,
      systemPrompt,
      icon: icon || 'User',
      isSystem: false,
    });

    res.json(newPersona);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. حذف پرسونای شخصی
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
