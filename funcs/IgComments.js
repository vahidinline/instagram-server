const axios = require('axios');
const InstagramComment = require('../models/InstagramComment'); // adjust the path as needed

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
    // 1. Save incoming comment to DB
    const savedComment = await InstagramComment.create({
      commentId: comment.id,
      parentId: comment.parent_id,
      text: comment.text,
      mediaId: comment.media?.id,
      mediaType: comment.media?.media_product_type,
      from: comment.from,
    });

    // 2. Send to AI engine (n8n)
    const response = await axios.post(
      'https://mcp.vahidafshari.com/webhook/ig-ai-reply',
      aiPayload
    );
    const aiReply = response.data;
    console.log('✅ AI Response:', aiReply);

    // 3. Send reply to Instagram comment
    const replyRes = await axios.post(
      `https://graph.instagram.com/v23.0/${comment.id}/replies`,
      {
        message: aiReply,
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

    console.log('✅ Successfully replied to comment:', replyRes.data);

    // 4. Update DB with AI reply
    savedComment.aiReply = {
      text: aiReply,
      repliedAt: new Date(),
    };
    await savedComment.save();

    return { success: true, aiReply };
  } catch (err) {
    console.error(
      '❌ Error handling IG comment:',
      err.response?.data || err.message
    );
    return { success: false, error: err.message };
  }
};

module.exports = igComments;
