const express = require('express');
const router = express.Router();
const multer = require('multer');
// const pdfParse = require('pdf-parse'); // <--- این خط حذف یا کامنت شد تا خطا ندهد
const fs = require('fs');
const azureService = require('../services/azureService');
const IGConnections = require('../models/IG-Connections');
const authMiddleware = require('../middleware/auth');

// تنظیمات آپلود موقت
const upload = multer({ dest: 'uploads/' });

// 1. آپلود فایل (TXT only for now)
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

      // چک کردن مالکیت اکانت
      const account = await IGConnections.findOne({
        ig_userId: ig_accountId,
        user_id: req.user.id,
      });
      if (!account) return res.status(403).json({ error: 'Access denied' });

      let textContent = '';

      // --- اصلاحیه: غیرفعال کردن موقت PDF ---
      if (file.mimetype === 'application/pdf') {
        // const dataBuffer = fs.readFileSync(file.path);
        // const data = await pdfParse(dataBuffer);
        // textContent = data.text;
        fs.unlinkSync(file.path); // حذف فایل آپلود شده
        return res
          .status(400)
          .json({
            error:
              'آپلود PDF موقتاً غیرفعال است. لطفاً از فایل TXT استفاده کنید.',
          });
      } else if (file.mimetype === 'text/plain') {
        textContent = fs.readFileSync(file.path, 'utf8');
      } else {
        fs.unlinkSync(file.path);
        return res
          .status(400)
          .json({ error: 'Unsupported file type. Use TXT.' });
      }

      // تمیزکاری فایل موقت
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

      // ارسال به آژور
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
      // حذف فایل در صورت ارور
      if (req.file && fs.existsSync(req.file.path))
        fs.unlinkSync(req.file.path);
      res.status(500).json({ error: e.message });
    }
  }
);

// 2. تست چت (Playground API)
router.post('/test-chat', authMiddleware, async (req, res) => {
  try {
    const { ig_accountId, query, systemPrompt } = req.body;

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
