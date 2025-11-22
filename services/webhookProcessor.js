const axios = require('axios');
const IGConnections = require('../models/IG-Connections');
const Triggers = require('../models/Triggers');

// Base URL for Instagram Graph API (New Flow)
const GRAPH_URL = 'https://graph.instagram.com/v21.0';

/**
 * Retrieves the Long-Lived Access Token for a specific IG Account
 */
async function getAccessToken(igAccountId) {
  const connection = await IGConnections.findOne({ ig_userId: igAccountId });
  if (!connection) {
    console.error(`❌ No connection found for IG Account: ${igAccountId}`);
    return null;
  }
  return connection.access_token;
}

/**
 * Finds a matching trigger based on text content
 */
async function findMatchingTrigger(igAccountId, text, type) {
  if (!text) return null;

  const triggers = await Triggers.find({
    ig_accountId: igAccountId,
    is_active: true,
    type: { $in: [type, 'both'] },
  });

  const lowerText = text.toLowerCase();

  // Priority 1: Exact Match
  const exact = triggers.find(
    (t) => t.match_type === 'exact' && t.keyword === lowerText
  );
  if (exact) return exact;

  // Priority 2: Starts With
  const starts = triggers.find(
    (t) => t.match_type === 'starts_with' && lowerText.startsWith(t.keyword)
  );
  if (starts) return starts;

  // Priority 3: Contains
  const contains = triggers.find(
    (t) => t.match_type === 'contains' && lowerText.includes(t.keyword)
  );
  if (contains) return contains;

  return null;
}

/**
 * Handle Incoming Comments
 */
async function handleComment(entry, change) {
  const value = change.value;
  const igAccountId = entry.id; // The Professional Account ID
  const text = value.text;
  const commentId = value.id;

  // Don't reply to self (optional check if needed, usually webhook excludes self)

  const trigger = await findMatchingTrigger(igAccountId, text, 'comment');

  if (trigger) {
    const accessToken = await getAccessToken(igAccountId);
    if (!accessToken) return;

    console.log(`✅ Trigger found for comment: "${trigger.keyword}"`);

    try {
      // Reply to Comment Endpoint
      // POST https://graph.instagram.com/v21.0/{ig-comment-id}/replies
      await axios.post(
        `${GRAPH_URL}/${commentId}/replies`,
        { message: trigger.response_text },
        { params: { access_token: accessToken } }
      );
      console.log(`🚀 Replied to comment ${commentId}`);
    } catch (e) {
      console.error('❌ Comment Reply Failed:', e.response?.data || e.message);
    }
  }
}

/**
 * Handle Incoming Direct Messages
 */
async function handleMessage(entry, messaging) {
  const igAccountId = entry.id;
  const senderId = messaging.sender.id;
  const text = messaging.message?.text;

  if (!text) return;

  const trigger = await findMatchingTrigger(igAccountId, text, 'dm');

  if (trigger) {
    const accessToken = await getAccessToken(igAccountId);
    if (!accessToken) return;

    console.log(`✅ Trigger found for DM: "${trigger.keyword}"`);

    try {
      // Send Message Endpoint
      // POST https://graph.instagram.com/v21.0/me/messages
      // Note: For 'Instagram API with Instagram Login', we use 'me' or the IG User ID
      await axios.post(
        `${GRAPH_URL}/${igAccountId}/messages`,
        {
          recipient: { id: senderId },
          message: { text: trigger.response_text },
        },
        { params: { access_token: accessToken } }
      );
      console.log(`🚀 Replied to DM from ${senderId}`);
    } catch (e) {
      console.error('❌ DM Reply Failed:', e.response?.data || e.message);
    }
  }
}

module.exports = { handleComment, handleMessage };
