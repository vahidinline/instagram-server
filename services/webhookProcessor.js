const axios = require('axios');
const IGConnections = require('../models/IG-Connections');
const Triggers = require('../models/Triggers');

// Helper to get token from DB based on the IG Account receiving the webhook
async function getAccessToken(igAccountId) {
  const connection = await IGConnections.findOne({ ig_userId: igAccountId });
  return connection ? connection.access_token : null;
}

// Process Comment Webhook
async function handleComment(entry, change) {
  const value = change.value;
  const igAccountId = entry.id; // The business account receiving the comment
  const text = value.text;
  const commentId = value.id;

  // 1. Find matching triggers
  const trigger = await findMatchingTrigger(igAccountId, text, 'comment');

  if (trigger) {
    const accessToken = await getAccessToken(igAccountId);
    if (!accessToken) return console.log('No token found for', igAccountId);

    // 2. Send Reply (Public Reply to Comment)
    // For Private Reply use: POST /{ig_user_id}/messages with recipient: {comment_id}
    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${commentId}/replies`,
        {
          message: trigger.response_text,
        },
        {
          params: { access_token: accessToken },
        }
      );
      console.log(
        `Replied to comment ${commentId} with: ${trigger.response_text}`
      );
    } catch (e) {
      console.error('Comment Reply Failed', e.response?.data);
    }
  }
}

// Process Message Webhook
async function handleMessage(entry, messaging) {
  const igAccountId = entry.id;
  const senderId = messaging.sender.id;
  const text = messaging.message.text;

  if (!text) return; // Ignore likes/images for now

  // 1. Find matching triggers
  const trigger = await findMatchingTrigger(igAccountId, text, 'dm');

  if (trigger) {
    const accessToken = await getAccessToken(igAccountId);
    if (!accessToken) return console.log('No token found for', igAccountId);

    // 2. Send DM Reply
    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${igAccountId}/messages`,
        {
          recipient: { id: senderId },
          message: { text: trigger.response_text },
        },
        {
          params: { access_token: accessToken },
        }
      );
      console.log(
        `Replied to DM from ${senderId} with: ${trigger.response_text}`
      );
    } catch (e) {
      console.error('DM Reply Failed', e.response?.data);
    }
  }
}

// Logic to match keywords
async function findMatchingTrigger(igAccountId, text, type) {
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

module.exports = { handleComment, handleMessage };
