const express = require('express');
const router = express.Router();
const multer = require('multer');
const { BlobServiceClient } = require('@azure/storage-blob');
const crypto = require('crypto');
const authMiddleware = require('../middleware/auth');
const path = require('path');

// تنظیمات مولتر
const upload = multer({ storage: multer.memoryStorage() });

// --- اتصال ایمن به آژور (Safe Connection) ---
const AZURE_CONN_STR = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_NAME || 'media';

let containerClient = null;

if (AZURE_CONN_STR) {
  try {
    const blobServiceClient =
      BlobServiceClient.fromConnectionString(AZURE_CONN_STR);
    containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    console.log('✅ Azure Blob Storage Connected.');
  } catch (e) {
    console.error('⚠️ Azure Storage Connection Failed:', e.message);
  }
} else {
  console.warn(
    '⚠️ AZURE_STORAGE_CONNECTION_STRING is missing in .env. Uploads will fail.'
  );
}

// --- روت آپلود ---
router.post(
  '/upload',
  authMiddleware,
  upload.single('file'),
  async (req, res) => {
    try {
      // 1. بررسی وضعیت سرویس
      if (!containerClient) {
        console.error('Upload attempted but Storage is not configured.');
        return res
          .status(500)
          .json({ error: 'Storage service is not configured on server.' });
      }

      // 2. بررسی فایل
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // 3. اطمینان از وجود کانتینر (Lazy Creation)
      await containerClient.createIfNotExists({ access: 'blob' });

      // 4. تولید نام یکتا
      const fileExt = path.extname(req.file.originalname);
      const fileName = `${req.user.id}-${crypto
        .randomBytes(8)
        .toString('hex')}${fileExt}`;

      // 5. آپلود
      const blockBlobClient = containerClient.getBlockBlobClient(fileName);

      await blockBlobClient.uploadData(req.file.buffer, {
        blobHTTPHeaders: { blobContentType: req.file.mimetype },
      });

      // 6. بازگشت لینک
      res.json({
        success: true,
        url: blockBlobClient.url,
        type: req.file.mimetype,
      });
    } catch (e) {
      console.error('Media Upload Error:', e.message);
      res.status(500).json({ error: 'Media Upload Failed' });
    }
  }
);

module.exports = router;
