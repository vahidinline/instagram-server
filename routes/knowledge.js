const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const azureService = require('../services/azureService');
const IGConnections = require('../models/IG-Connections');
const KnowledgeDoc = require('../models/KnowledgeDoc'); // <--- مدل جدید
const authMiddleware = require('../middleware/auth');

const upload = multer({ dest: 'uploads/' });

// 1. لیست فایل‌ها
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { ig_accountId } = req.query;
    // چک مالکیت (سریع)
    const account = await IGConnections.findOne({
      ig_userId: ig_accountId,
      user_id: req.user.id,
    });
    if (!account) return res.status(403).json({ error: 'Access denied' });

    const docs = await KnowledgeDoc.find({ ig_accountId }).sort({
      created_at: -1,
    });
    res.json(docs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. آپلود فایل
router.post(
  '/upload',
  authMiddleware,
  upload.single('file'),
  async (req, res) => {
    try {
      const { ig_accountId } = req.body;
      const file = req.file;

      if (!file || !ig_accountId)
        return res.status(400).json({ error: 'Missing data' });

      const account = await IGConnections.findOne({
        ig_userId: ig_accountId,
        user_id: req.user.id,
      });
      if (!account) return res.status(403).json({ error: 'Access denied' });

      let textContent = '';
      let fileType = 'txt';

      if (file.mimetype === 'text/plain') {
        textContent = fs.readFileSync(file.path, 'utf8');
        fileType = 'txt';
      } else {
        // فعلا PDF غیرفعال است طبق توافق قبلی
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res
          .status(400)
          .json({ error: 'Only TXT files supported currently.' });
      }

      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

      // ارسال به آژور
      // نکته: ما docId را اینجا میسازیم یا از آژور میگیریم؟
      // در سرویس آژور (azureService) دیدیم که خودش ID میسازد.
      // باید سرویس را طوری تغییر دهیم که ID را برگرداند تا ما ذخیره کنیم.

      // ** اصلاح موقت: ** بیایید فرض کنیم azureService.addDocument شناسه docId را برمیگرداند
      // (باید سرویس آژور را هم کمی اصلاح کنیم که ID برگرداند)

      const docId = await azureService.addDocument(
        ig_accountId,
        file.originalname,
        textContent
      );

      if (docId) {
        // ذخیره در دیتابیس ما
        const newDoc = await KnowledgeDoc.create({
          ig_accountId,
          fileName: file.originalname,
          fileType,
          azureDocId: docId, // این را لازم داریم برای حذف
        });
        res.json(newDoc);
      } else {
        res.status(500).json({ error: 'Indexing failed.' });
      }
    } catch (e) {
      if (req.file && fs.existsSync(req.file.path))
        fs.unlinkSync(req.file.path);
      res.status(500).json({ error: e.message });
    }
  }
);

// 3. حذف فایل
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const doc = await KnowledgeDoc.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // چک مالکیت
    const account = await IGConnections.findOne({
      ig_userId: doc.ig_accountId,
      user_id: req.user.id,
    });
    if (!account) return res.status(403).json({ error: 'Access denied' });

    // حذف از آژور
    await azureService.deleteDocument(doc.azureDocId);

    // حذف از دیتابیس
    await KnowledgeDoc.findByIdAndDelete(req.params.id);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. تست چت (مثل قبل)
router.post('/test-chat', authMiddleware, async (req, res) => {
  // ... (کد قبلی بدون تغییر) ...
  try {
    const { ig_accountId, query, systemPrompt } = req.body;
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
