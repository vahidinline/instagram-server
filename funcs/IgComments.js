const axios = require('axios');
const InstagramComment = require('../models/InstagramComment'); // adjust path as needed

const igComments = async (entry, field, value) => {
  const comment = value;

  const aiPayload = {
    userId: entry.id,
    igAccountId: entry.id,
    eventType: 'comment',
    eventPayload: {
      text: comment.text,
      id: comment.id,
      from: comment.from,
    },
  };

  console.log('🤖 AI Payload:', JSON.stringify(aiPayload, null, 2));

  try {
    // 1. Send to AI engine (n8n)
    const response = await axios.post(
      'https://mcp.vahidafshari.com/webhook/ig-ai-reply',
      aiPayload
    );

    const aiReplyText = response.data;
    console.log('✅ AI Response:', aiReplyText);

    // 2. Reply to comment on Instagram
    const replyRes = await axios.post(
      `https://graph.instagram.com/v23.0/${comment.id}/replies`,
      {
        message: aiReplyText,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        params: {
          access_token: process.env.IG_USER_TOKEN,
        },
      }
    );

    console.log('✅ Successfully replied on Instagram:', replyRes.data);

    // 3. Store the entire event (including AI reply) in MongoDB
    const saved = await InstagramComment.create({
      commentId: comment.id,
      parentId: comment.parent_id,
      text: comment.text,
      mediaId: comment.media?.id,
      mediaType: comment.media?.media_product_type,
      from: comment.from,
      aiReply: {
        text: aiReplyText,
        repliedAt: new Date(),
      },
    });

    console.log('📦 Comment and AI reply saved in DB:', saved._id);

    return { success: true, aiReply: aiReplyText };
  } catch (err) {
    console.error(
      '❌ Error in IG comment handler:',
      err.response?.data || err.message
    );
    return { success: false, error: err.message };
  }
};

module.exports = igComments;
