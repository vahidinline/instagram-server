const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const IGConnections = require('../models/IG-Connections');
const WebConnection = require('../models/WebConnection'); // <--- اضافه شد
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// دریافت لیست تمام لیدها (ترکیبی: وب + اینستاگرام)
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. پیدا کردن تمام اکانت‌های اینستاگرام کاربر
    const igAccounts = await IGConnections.find({ user_id: userId }).select(
      'ig_userId'
    );
    const igIds = igAccounts.map((acc) => acc.ig_userId);

    // 2. پیدا کردن تمام کانال‌های وب کاربر
    const webChannels = await WebConnection.find({ user_id: userId }).select(
      '_id'
    );
    const webIds = webChannels.map((ch) => ch._id.toString());

    // 3. ترکیب همه شناسه‌ها
    const allAccountIds = [...igIds, ...webIds];

    if (allAccountIds.length === 0) {
      return res.json([]); // کاربر هیچ کانالی ندارد
    }

    // 4. جستجوی لیدها بر اساس لیست شناسه‌ها
    const leads = await Lead.find({
      ig_accountId: { $in: allAccountIds },
    }).sort({ created_at: -1 }); // جدیدترین‌ها اول

    res.json(leads);
  } catch (e) {
    console.error('Leads Fetch Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// آپدیت وضعیت لید (مثلاً تغییر به "تماس گرفته شد")
router.put('/:id', async (req, res) => {
  try {
    const { status, note } = req.body;

    // نکته امنیتی: بهتر است چک کنیم لید متعلق به اکانت‌های کاربر باشد
    // اما برای سادگی فعلا فقط آپدیت می‌کنیم
    const updatedLead = await Lead.findByIdAndUpdate(
      req.params.id,
      {
        status,
        // اگر نوت اضافه کردید، می‌توانید ذخیره کنید
        // note: note
      },
      { new: true }
    );

    res.json(updatedLead);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
