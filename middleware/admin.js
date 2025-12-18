module.exports = function (req, res, next) {
  // این میدل‌ویر بعد از authMiddleware اجرا می‌شود، پس req.user وجود دارد
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Access Denied. Admins only.' });
  }
};
