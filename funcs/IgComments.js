const axios = require('axios');
const InstagramComment = require('../models/InstagramComment');

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

  try {
    // 1. Save incoming comment to MongoDB
    await InstagramComment.create({
      commentId: comment.id,
      parentId: comment.parent_id,
      text: comment.text,
      mediaId: comment.media?.id,
      mediaType: comment.media?.media_product_type,
      from: comment.from,
      createdAt: new Date(),
    });
    console.log('✅ Saved comment to DB:', comment.id);
    // 2. Send comment to AI engine
    const response = await axios.post(
      'https://mcp.vahidafshari.com/webhook/ig-ai-reply',
      aiPayload
    );
    const aiReplyText = response.data;
    console.log('aiReplyText:', aiReplyText);
    // 3. Send a private reply (DM) to the commenter via Instagram Graph API
    const yourIgAccountId = entry.id; // The ID of YOUR Instagram Professional Account
    const commentIdToReplyTo = comment.id; // The ID of the comment you received

    await axios.post(
      `https://graph.facebook.com/v20.0/${yourIgAccountId}/messages`, // Use graph.facebook.com endpoint
      {
        recipient: {
          comment_id: commentIdToReplyTo,
        },
        message: {
          text: aiReplyText,
        },
        messaging_type: 'RESPONSE', // Good practice to include messaging_type
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.IG_PAGE_TOKEN}`, // Use Authorization header
          'Content-Type': 'application/json',
        },
      }
    );

    // 4. Update the same document with AI reply + updatedAt
    const updated = await InstagramComment.findOneAndUpdate(
      { commentId: comment.id },
      {
        $set: {
          aiReply: {
            text: aiReplyText,
            repliedAt: new Date(),
          },
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    console.log('✅ Updated comment with AI reply:', updated._id);

    return { success: true, aiReply: aiReplyText };
  } catch (err) {
    console.error(
      '❌ Error in IG comment flow:',
      err.response?.data || err.message
    );
    return { success: false, error: err.message };
  }
};

module.exports = igComments;
