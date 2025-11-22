const express = require('express');
const IGConnections = require('../models/IG-Connections');
const router = express.Router();
const axios = require('axios');

// --- Configuration ---
// Ensure these match your App Dashboard > Instagram Basic Display > Instagram App ID/Secret
// OR strictly the "Instagram" product settings if using the new flow.
const INSTAGRAM_APP_ID = process.env.INSTAGRAM_CLIENT_ID;
const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_CLIENT_SECRET;
const REDIRECT_URI = process.env.INSTAGRAM_REDIRECT_URI;

/**
 * 1. Generate the OAuth URL
 * Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
 */

// server/routes/auth.js

router.get('/login-url', (req, res) => {
  const { userId } = req.query;

  const scopes = [
    'instagram_business_basic',
    'instagram_business_manage_messages',
    'instagram_business_manage_comments',
    'instagram_business_content_publish',
  ].join(',');

  const state = JSON.stringify({ app_userId: userId });

  // REMOVED: &enable_fb_login=0
  // REMOVED: &force_authentication=1
  const url = `https://www.instagram.com/oauth/authorize?client_id=${process.env.INSTAGRAM_CLIENT_ID}&redirect_uri=${process.env.INSTAGRAM_REDIRECT_URI}&response_type=code&scope=${scopes}&state=${state}`;

  res.json({ url });
});
// router.get('/login-url', (req, res) => {
//   const { userId } = req.query;

//   // New Scopes for "Instagram API with Instagram Login"
//   const scopes = [
//     'instagram_business_basic',
//     'instagram_business_manage_messages',
//     'instagram_business_manage_comments',
//     'instagram_business_content_publish',
//   ].join(',');

//   const state = JSON.stringify({ app_userId: userId });

//   // Endpoint is www.instagram.com, NOT facebook.com
//   const url = `https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1&client_id=${INSTAGRAM_APP_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=${scopes}&state=${state}`;

//   res.json({ url });
// });

/**
 * 2. Handle the Callback
 */
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) return res.status(400).send('No code received');

  try {
    const decodedState = state ? JSON.parse(decodeURIComponent(state)) : {};
    const appUserId = decodedState.app_userId;

    // A. Exchange Code for Short-Lived Token
    // Endpoint: api.instagram.com
    const shortTokenForm = new URLSearchParams({
      client_id: INSTAGRAM_APP_ID,
      client_secret: INSTAGRAM_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      code: code.replace(/#_$/, ''), // Remove trailing hash if present
    });

    const shortResp = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      shortTokenForm
    );
    const { access_token: shortToken, user_id: shortTokenUserId } =
      shortResp.data;

    // B. Exchange Short-Lived for Long-Lived Token
    // Endpoint: graph.instagram.com
    const longResp = await axios.get(
      'https://graph.instagram.com/access_token',
      {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: INSTAGRAM_APP_SECRET,
          access_token: shortToken,
        },
      }
    );

    const { access_token: longToken, expires_in } = longResp.data;

    // C. Get User Profile Details
    // We use the long token to fetch the profile.
    // Note: With this API, 'me' refers to the Instagram Professional Account itself.
    const profileResp = await axios.get(
      `https://graph.instagram.com/v21.0/me`,
      {
        params: {
          fields:
            'user_id,username,name,account_type,profile_picture_url,followers_count',
          access_token: longToken,
        },
      }
    );

    const profile = profileResp.data;

    // D. Save to Database
    await IGConnections.findOneAndUpdate(
      { ig_userId: profile.id }, // This is the Instagram User ID
      {
        app_userId: appUserId,
        ig_userId: profile.id,
        username: profile.username,
        account_name: profile.name || profile.username,
        profile_picture_url: profile.profile_picture_url,
        access_token: longToken,
        token_expires_at: new Date(Date.now() + expires_in * 1000),
        account_status: 'active',
      },
      { upsert: true, new: true }
    );

    // Redirect to frontend
    res.redirect(`${process.env.FRONTEND_URL}/accounts?status=success`);
  } catch (error) {
    console.error(
      'Instagram Auth Error:',
      error.response?.data || error.message
    );
    res.redirect(
      `${
        process.env.FRONTEND_URL
      }/accounts?status=error&message=${encodeURIComponent(error.message)}`
    );
  }
});

module.exports = router;
