const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const azureService = require('../services/azureService');
const IGConnections = require('../models/IG-Connections');
const authMiddleware = require('../middleware/auth');

// تنظیمات آپلود موقت
const upload = multer({ dest: 'uploads/' });

// 1. آپلود فایل (PDF/TXT)
router.post(
  '/upload',
  authMiddleware,
  upload.single('file'),
  async (req, res) => {
    try {
      const { ig_accountId } = req.body;
      const file = req.file;

      if (!file || !ig_accountId)
        return res.status(400).json({ error: 'File and Account ID required' });

      // چک کردن مالکیت اکانت (امنیت)
      const account = await IGConnections.findOne({
        ig_userId: ig_accountId,
        user_id: req.user.id,
      });
      if (!account) return res.status(403).json({ error: 'Access denied' });

      let textContent = '';

      // استخراج متن
      if (file.mimetype === 'application/pdf') {
        const dataBuffer = fs.readFileSync(file.path);
        const data = await pdfParse(dataBuffer);
        textContent = data.text;
      } else if (file.mimetype === 'text/plain') {
        textContent = fs.readFileSync(file.path, 'utf8');
      } else {
        return res
          .status(400)
          .json({ error: 'Unsupported file type. Use PDF or TXT.' });
      }

      // تمیزکاری فایل موقت
      fs.unlinkSync(file.path);

      // ارسال به آژور
      // اینجا کل متن را یکجا میفرستیم. در نسخه پرو باید Chunk شود.
      // فعلا برای MVP فرض میکنیم فایل‌ها کوچک هستند.
      const success = await azureService.addDocument(
        ig_accountId,
        file.originalname,
        textContent
      );

      if (success) {
        res.json({ success: true, message: 'File processed and indexed.' });
      } else {
        res.status(500).json({ error: 'Indexing failed.' });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// 2. تست چت (Playground API)
router.post('/test-chat', authMiddleware, async (req, res) => {
  try {
    const { ig_accountId, query, systemPrompt } = req.body;

    // چک مالکیت
    const account = await IGConnections.findOne({
      ig_userId: ig_accountId,
      user_id: req.user.id,
    });
    if (!account) return res.status(403).json({ error: 'Access denied' });

    const response = await azureService.askAI(
      ig_accountId,
      query,
      systemPrompt
    );
    res.json({ response });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
