const express = require('express');
const IGConnections = require('../models/IG-Connections');
const SystemLogs = require('../models/SystemLogs');
const router = express.Router();
const axios = require('axios');

router.get('/callback', async (req, res) => {
  let { code, state, userId } = req.query; // Renamed userId from query to avoid conflict
  console.log('Received query parameters:', req.query);
  // --- BEGIN DEBUGGING FOR ENV VARS ---
  // Remove these logs in production, especially the secret
  console.log('--- Environment Variable Check ---');
  console.log(
    'process.env.INSTAGRAM_CLIENT_ID:',
    process.env.INSTAGRAM_CLIENT_ID
  );
  console.log(
    'process.env.INSTAGRAM_CLIENT_SECRET:',
    process.env.INSTAGRAM_CLIENT_SECRET ? '***********' : undefined
  ); // Mask secret
  console.log(
    'process.env.INSTAGRAM_REDIRECT_URI:',
    process.env.INSTAGRAM_REDIRECT_URI
  );
  console.log('--------------------------------');
  // --- END DEBUGGING FOR ENV VARS ---

  console.log(
    'Callback received. Code:',
    code,
    'State:',
    state,
    'userId:',
    userId
  );

  if (!code) {
    console.error('Error: No code received from Instagram.');
    return res.status(400).json({
      status: false,
      message:
        'Instagram authentication failed: No authorization code provided.',
    });
  }

  const cleanCode = code.replace(/#_$/, '');
  console.log('Cleaned code:', cleanCode);

  const tokenParams = new URLSearchParams();
  tokenParams.append('client_id', process.env.INSTAGRAM_CLIENT_ID);
  tokenParams.append('client_secret', process.env.INSTAGRAM_CLIENT_SECRET);
  tokenParams.append('grant_type', 'authorization_code');
  tokenParams.append('redirect_uri', process.env.INSTAGRAM_REDIRECT_URI);
  tokenParams.append('code', cleanCode);

  console.log(
    'Using Redirect URI for token exchange:',
    process.env.INSTAGRAM_REDIRECT_URI
  );
  // Avoid logging full tokenParams if client_secret is included and not masked

  let parsedState = {};
  let appUserId = userId; // Default to userId from query if state doesn't provide one

  if (state) {
    try {
      // Attempt to parse state as JSON, assuming it was stringified and URI encoded
      const decodedState = decodeURIComponent(state);
      parsedState = JSON.parse(decodedState);
      console.log('Parsed state from JSON:', parsedState);
      // If your state contains your application's user ID, use it:
      if (parsedState.app_userId) {
        appUserId = parsedState.app_userId;
        console.log('Using appUserId from parsedState:', appUserId);
      } else if (parsedState.userId) {
        // Or if you named it userId in state
        appUserId = parsedState.userId;
        console.log('Using userId from parsedState:', appUserId);
      }
    } catch (e) {
      console.warn(
        'State is not valid JSON. Original state:',
        state,
        'Error:',
        e.message
      );
      // If state is not JSON, it might be a simple string (e.g., CSRF token or a simple ID)
      // For now, we'll use a fallback or assume it's not critical for this example.
      // You might need to handle this differently based on your state's purpose.
      // If it's just a CSRF token, you'd verify it here.
      // For the redirect_uri, source, etc., they will be undefined if not in parsedState.
      parsedState = {
        // Provide fallbacks if state parsing fails and these are needed
        redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
      };
      console.log('Using fallback parsedState:', parsedState);
    }
  } else {
    console.warn('State parameter is missing.');
    // Handle missing state if it's critical
    parsedState = {
      redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
    };
  }

  if (!appUserId) {
    console.error(
      'Critical: appUserId is not available from query or state. Cannot save connection.'
    );
    // Decide how to handle this. Maybe redirect to an error page or login.
    // For this example, we'll proceed but the DB save might fail or be incomplete.
  }

  try {
    console.log(
      'Attempting to get short-lived token with Client ID:',
      process.env.INSTAGRAM_CLIENT_ID
    ); // Check ID again
    const shortTokenResp = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      tokenParams,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const shortToken = shortTokenResp.data.access_token;
    const igUserIdFromToken = shortTokenResp.data.user_id; // Instagram returns user_id here

    console.log(
      'Short-lived token received:',
      shortToken ? 'OK' : 'FAILED',
      'IG User ID from token:',
      igUserIdFromToken
    );

    const longTokenResp = await axios.get(
      'https://graph.instagram.com/access_token',
      {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: process.env.INSTAGRAM_CLIENT_SECRET,
          access_token: shortToken,
        },
      }
    );

    const { access_token, expires_in } = longTokenResp.data;
    console.log('Long-lived token received. Expires in:', expires_in);

    // Use values from parsedState if available, otherwise fallback or use from token
    const finalRedirectUri = process.env.INSTAGRAM_REDIRECT_URI;

    const finalSource = parsedState.source || 'unknown';
    // ig_user_id from state could be a pre-fetched ID, but igUserIdFromToken is authoritative after auth
    const finalIgUserId = igUserIdFromToken;
    const finalAccountName =
      parsedState.account_name_from_state || 'Instagram Account';

    const redirectUrl = `${finalRedirectUri}?access_token=${access_token}&expires_in=${expires_in}&source=${finalSource}&ig_user_id=${finalIgUserId}`;
    console.log('Redirecting to:', redirectUrl);

    if (appUserId && finalIgUserId) {
      console.log(
        'Saving Instagram connection with appUserId:',
        appUserId,
        'and finalIgUserId:',
        finalIgUserId
      );
      const igConnection = new IGConnections({
        app_userId: appUserId,
        ig_userId: finalIgUserId,
        access_token,
        token_expires_at: new Date(Date.now() + expires_in * 1000),
        token_created_at: new Date(),
        last_update: new Date(),
        account_name: finalAccountName,
      });
      const res = await igConnection.save();
      console.log('Instagram connection saved successfully:', res);
      console.log('Instagram connection saved:', igConnection._id);
    } else {
      console.warn(
        'Cannot save IG Connection: Missing appUserId or finalIgUserId.',
        { appUserId, finalIgUserId }
      );
    }

    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('Instagram auth callback error:', error.message);
    if (error.response) {
      console.error('Error Response Data:', error.response.data);
      console.error('Error Response Status:', error.response.status);
      // console.error('Error Response Headers:', error.response.headers); // Can be very verbose
    } else if (error.request) {
      console.error('Error Request:', error.request);
    }
    // console.error('Full error object for system logs line 80:', error); // Keep this for detailed debugging

    return res.status(500).json({
      status: false,
      message: 'Instagram authentication failed during token exchange.',
      error: error.response ? error.response.data : error.message,
    });
  }
});

module.exports = router;
