const express = require('express');
const router = express.Router();
const multer = require('multer');
const { BlobServiceClient } = require('@azure/storage-blob');
const crypto = require('crypto');
const authMiddleware = require('../middleware/auth');
const path = require('path');

// تنظیمات مولتر (حافظه موقت)
const upload = multer({ storage: multer.memoryStorage() });

// اتصال به آژور
const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'media';
const containerClient = blobServiceClient.getContainerClient(containerName);

router.post(
  '/upload',
  authMiddleware,
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      // تولید نام یکتا برای فایل
      const fileExt = path.extname(req.file.originalname);
      const fileName = `${req.user.id}-${crypto
        .randomBytes(8)
        .toString('hex')}${fileExt}`;

      // آپلود در آژور
      const blockBlobClient = containerClient.getBlockBlobClient(fileName);

      await blockBlobClient.uploadData(req.file.buffer, {
        blobHTTPHeaders: { blobContentType: req.file.mimetype },
      });

      // ساخت لینک عمومی
      const publicUrl = blockBlobClient.url;

      res.json({
        success: true,
        url: publicUrl,
        type: req.file.mimetype,
      });
    } catch (e) {
      console.error('Upload Error:', e.message);
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

module.exports = router;
