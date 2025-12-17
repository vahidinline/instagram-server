const jwt = require('jsonwebtoken');

// کلید رمزنگاری (باید در .env باشد)
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_change_me';

const authMiddleware = (req, res, next) => {
  // 1. دریافت توکن از هدر
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Access Denied. No token provided.' });
  }

  try {
    // 2. اعتبارسنجی توکن
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified; // ذخیره اطلاعات کاربر در درخواست (req.user.id)
    next(); // اجازه عبور
  } catch (err) {
    res.status(400).json({ error: 'Invalid Token' });
  }
};

module.exports = authMiddleware;
