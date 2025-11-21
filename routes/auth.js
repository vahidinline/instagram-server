const express = require('express');
const IGConnections = require('../models/IG-Connections');
const router = express.Router();
const axios = require('axios');

// 1. Construct the correct OAuth URL for the frontend
router.get('/login-url', (req, res) => {
  const { userId } = req.query;
  // Requesting all necessary permissions for DMs and Comments
  const scopes = [
    'instagram_basic',
    'instagram_manage_comments',
    'instagram_manage_messages',
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_metadata',
  ].join(',');

  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;
  const state = JSON.stringify({ app_userId: userId });

  const url = `https://www.facebook.com/v17.0/dialog/oauth?client_id=${process.env.INSTAGRAM_CLIENT_ID}&redirect_uri=${redirectUri}&scope=${scopes}&state=${state}&response_type=code`;

  res.json({ url });
});

// 2. Handle Callback
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  try {
    const decodedState = JSON.parse(decodeURIComponent(state));
    const appUserId = decodedState.app_userId;

    // Exchange Code for Short Token
    const tokenParams = new URLSearchParams({
      client_id: process.env.INSTAGRAM_CLIENT_ID,
      client_secret: process.env.INSTAGRAM_CLIENT_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
      code: code.replace(/#_$/, ''),
    });

    const shortResp = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      tokenParams
    );
    const shortToken = shortResp.data.access_token;

    // Exchange for Long Token
    const longResp = await axios.get(
      'https://graph.instagram.com/access_token',
      {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: process.env.INSTAGRAM_CLIENT_SECRET,
          access_token: shortToken,
        },
      }
    );

    const { access_token, expires_in } = longResp.data;

    // Get User Details (Page ID)
    // Note: We need to query /me/accounts to get the linked IG Business Account ID
    const pagesResp = await axios.get(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${access_token}&fields=instagram_business_account{id,username,profile_picture_url},name`
    );

    const connectedPages = pagesResp.data.data;

    // Save each connected page
    for (const page of connectedPages) {
      if (page.instagram_business_account) {
        await IGConnections.findOneAndUpdate(
          { ig_userId: page.instagram_business_account.id },
          {
            app_userId: appUserId,
            ig_userId: page.instagram_business_account.id,
            access_token: access_token, // Store token per user/page
            account_name: page.instagram_business_account.username || page.name,
            profile_picture_url:
              page.instagram_business_account.profile_picture_url,
            token_expires_at: new Date(Date.now() + expires_in * 1000),
            account_status: 'active',
          },
          { upsert: true, new: true }
        );
      }
    }

    // Redirect back to frontend dashboard
    res.redirect(`${process.env.FRONTEND_URL}/accounts?status=success`);
  } catch (error) {
    console.error('Auth Error:', error.response?.data || error.message);
    res.redirect(`${process.env.FRONTEND_URL}/accounts?status=error`);
  }
});

module.exports = router;
