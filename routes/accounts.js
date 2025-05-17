const express = require('express');
const IGConnections = require('../models/IG-Connections');
const SystemLogs = require('../models/SystemLogs');
const IGAccountSchema = require('../models/IG-Accounts');
const router = express.Router();
const axios = require('axios');

router.get('/', async (req, res) => {
  const { userId } = req.query; // اصلاح شد: حالا از req.query گرفته می‌شود
  console.log('userId:', userId);

  try {
    const accounts = await IGConnections.find({ app_userId: userId }).lean();
    console.log('accounts:', accounts);

    if (!accounts || accounts.length === 0) {
      return res.status(404).json({ message: 'No accounts found' });
    }

    res.status(200).json(accounts);
  } catch (error) {
    console.error('DB error:', error);
    res.status(500).json({ message: 'Error retrieving accounts' });
  }
});

module.exports = router;
