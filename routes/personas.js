const express = require('express');
const router = express.Router();
const Persona = require('../models/Persona');
const authMiddleware = require('../middleware/auth');
const { buildSystemPrompt } = require('../utils/promptBuilder'); // فرض بر وجود

// 1. دریافت لیست پرسوناها (با سانسور IP)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const personas = await Persona.find({
      $or: [{ isSystem: true }, { user_id: req.user.id }],
    }).sort({ isLocked: -1, isSystem: -1, created_at: -1 });

    // 🛡️ سانسور کردن پرامپت برای پرسوناهای قفل شده
    const safePersonas = personas.map((p) => {
      if (p.isLocked) {
        // کپی کردن آبجکت برای جلوگیری از تغییر در رفرنس دیتابیس
        const safeP = p.toObject();
        safeP.systemPrompt = '🔒 Protected by Consultant License'; // مخفی کردن راز
        return safeP;
      }
      return p;
    });

    res.json(safePersonas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. ساخت پرسونا (توسط کاربر)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, gender, avatar, config, systemPrompt } = req.body;

    // کاربر عادی نمی‌تواند پرسونای قفل شده بسازد
    const newPersona = await Persona.create({
      user_id: req.user.id,
      name,
      gender,
      avatar,
      config,
      systemPrompt: systemPrompt || 'Default Prompt',
      isSystem: false,
      isLocked: false,
    });

    res.json(newPersona);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. حذف پرسونا
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const persona = await Persona.findOne({
      _id: req.params.id,
      user_id: req.user.id,
    });

    if (!persona) return res.status(404).json({ error: 'Not found' });

    // 🛡️ جلوگیری از حذف پرسونای VIP
    if (persona.isLocked) {
      return res
        .status(403)
        .json({
          error:
            'شما اجازه حذف این دستیار مدیریت‌شده را ندارید. با پشتیبانی تماس بگیرید.',
        });
    }

    await Persona.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
