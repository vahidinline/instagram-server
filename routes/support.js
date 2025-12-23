const express = require('express');
const router = express.Router();
const supportAgent = require('../services/supportAgent');
const Ticket = require('../models/Ticket');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// 1. چت با هوش مصنوعی (برای ویجت شناور)
router.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    const result = await supportAgent.handleUserChat(
      req.user,
      message,
      history
    );
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. دریافت لیست تیکت‌های کاربر
router.get('/tickets', async (req, res) => {
  try {
    const tickets = await Ticket.find({ user_id: req.user.id }).sort({
      updated_at: -1,
    }); // آخرین تغییرات بالا
    res.json(tickets);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. دریافت جزئیات یک تیکت خاص
router.get('/tickets/:id', async (req, res) => {
  try {
    const ticket = await Ticket.findOne({
      _id: req.params.id,
      user_id: req.user.id,
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    res.json(ticket);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. ارسال پاسخ کاربر به تیکت (Reply)
router.post('/tickets/:id/reply', async (req, res) => {
  try {
    const { message } = req.body;
    const ticket = await Ticket.findOne({
      _id: req.params.id,
      user_id: req.user.id,
    });

    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.status === 'closed')
      return res.status(400).json({ error: 'This ticket is closed.' });

    // افزودن پیام
    ticket.messages.push({
      sender: 'user',
      content: message,
      created_at: new Date(),
    });

    // تغییر وضعیت به "پاسخ داده شده توسط کاربر"
    ticket.status = 'user_replied';
    ticket.updated_at = new Date();

    await ticket.save();
    res.json(ticket);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. ایجاد تیکت جدید دستی (از پنل)
router.post('/create', async (req, res) => {
  try {
    const { subject, description, priority } = req.body;

    const newTicket = await Ticket.create({
      user_id: req.user.id,
      subject,
      priority: priority || 'medium',
      status: 'open',
      messages: [
        {
          sender: 'user',
          content: description,
          created_at: new Date(),
        },
      ],
    });

    res.json(newTicket);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
