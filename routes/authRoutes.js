const express = require('express');
const router = express.Router();
const {
  googleLogin,
  sendOtp,
  verifyOtp,
} = require('../controllers/authController');

// روت گوگل (این باعث می‌شود آدرس /api/auth/google کار کند)
router.post('/google', googleLogin);

// روت‌های موبایل (اگر دارید)
// router.post('/send-otp', sendOtp);
// router.post('/verify-otp', verifyOtp);

module.exports = router;
