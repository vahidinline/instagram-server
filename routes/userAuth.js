const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

// --- روت‌های عمومی (بدون نیاز به توکن) ---
router.post('/google', authController.googleLogin); // <--- روت جدید گوگل
router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);

// --- روت‌های محافظت شده (نیاز به لاگین) ---
router.get('/me', authMiddleware, authController.getMe);
router.put('/profile', authMiddleware, authController.updateProfile);

module.exports = router;
