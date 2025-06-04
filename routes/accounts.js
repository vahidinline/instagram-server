const express = require('express');

const IGConnections = require('../models/IG-Connections');
const SystemLogs = require('../models/SystemLogs');
const IGAccountSchema = require('../models/IG-Accounts');
const router = express.Router();
const axios = require('axios');
const e = require('express');

router.get('/', async (req, res) => {
  const { userId } = req.query;
  console.log('userId:', userId);

  try {
    const accounts = await IGConnections.find({ app_userId: userId }).lean();
    console.log('accounts:', accounts);

    if (!accounts || accounts.length === 0) {
      return res.status(404).json({ message: 'No accounts found' });
    }
    const response = accounts.map((account) => {
      return {
        id: account._id,
        userId: account.app_userId,
        ig_accountId: account.ig_accountId,
        account_name: 'account_name',
        created_at: account.token_expires_at,
        expires_at: account.token_expires_at,
      };
    });

    res.status(200).json(accounts);
  } catch (error) {
    console.error('DB error:', error);
    res.status(500).json({ message: 'Error retrieving accounts' });
  }
});

module.exports = router;
